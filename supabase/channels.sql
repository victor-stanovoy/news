-- SparkNews channels and programme schedule. Paste into Supabase > SQL Editor > New query > Run. Safe to run again.
-- Run supabase/live.sql and supabase/tvmedia.sql first (run them again afterwards if you like: that is harmless).
-- Gives you any number of radio and TV channels, each with a name and a topic, a library of programmes
-- (YouTube links and uploaded videos or audio) and a schedule that plays by itself when nobody is live.

-- 1. Channels: the existing "radio" and "tv" rows become your first two channels.
alter table public.live_channels drop constraint if exists live_channels_kind_check;
alter table public.live_channels add column if not exists type text;
alter table public.live_channels add column if not exists name text;
alter table public.live_channels add column if not exists topic text;
alter table public.live_channels add column if not exists description text;
alter table public.live_channels add column if not exists position int not null default 0;
alter table public.live_channels add column if not exists listed boolean not null default true;
update public.live_channels set type = kind where type is null and kind in ('radio', 'tv');
update public.live_channels set name = case kind when 'tv' then 'Live TV' else 'Live radio' end where name is null and kind in ('radio', 'tv');
update public.live_channels set position = case kind when 'tv' then 0 else 1 end where kind in ('tv', 'radio') and position = 0;
alter table public.live_channels drop constraint if exists live_channels_type_check;
alter table public.live_channels add constraint live_channels_type_check check (type in ('radio', 'tv'));
alter table public.live_channels drop constraint if exists live_channels_slug_check;
alter table public.live_channels add constraint live_channels_slug_check check (kind ~ '^[a-z0-9][a-z0-9-]{1,30}$');

-- what visitors may read about channels (no secrets)
drop view if exists public.live_channel_list;
create view public.live_channel_list as
  select kind as slug, type, coalesce(name, kind) as name, topic, description, position
  from public.live_channels where listed;
grant select on public.live_channel_list to anon, authenticated;

create or replace function public.channel_save(p_slug text, p_type text, p_name text, p_topic text, p_description text, p_listed boolean default true, p_position int default 0)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.editor_role() <> 'admin' then raise exception 'Only admins can change channels'; end if;
  if p_type not in ('radio', 'tv') then raise exception 'A channel is either radio or tv'; end if;
  if char_length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Please give the channel a name'; end if;
  insert into public.live_channels (kind, type, name, topic, description, listed, position)
  values (p_slug, p_type, left(trim(p_name), 80), nullif(left(trim(coalesce(p_topic, '')), 80), ''), nullif(left(trim(coalesce(p_description, '')), 300), ''), coalesce(p_listed, true), coalesce(p_position, 0))
  on conflict (kind) do update set name = excluded.name, topic = excluded.topic, description = excluded.description,
    listed = excluded.listed, position = excluded.position;
end $$;

create or replace function public.channel_delete(p_slug text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.editor_role() <> 'admin' then raise exception 'Only admins can change channels'; end if;
  if p_slug in ('tv', 'radio') then raise exception 'The two first channels cannot be deleted. Hide them instead.'; end if;
  delete from public.live_channels where kind = p_slug and not on_air;
end $$;
revoke execute on function public.channel_save(text, text, text, text, text, boolean, int), public.channel_delete(text) from public, anon;
grant execute on function public.channel_save(text, text, text, text, text, boolean, int), public.channel_delete(text) to authenticated;

-- 2. Programme library: a YouTube video or an uploaded file, with its length and a topic
create table if not exists public.programs (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(trim(title)) between 1 and 140),
  topic      text check (topic is null or char_length(topic) <= 60),
  source     text not null check (source in ('youtube', 'upload')),
  yt_id      text check (yt_id is null or yt_id ~ '^[A-Za-z0-9_-]{11}$'),
  path       text,
  media      text not null default 'video' check (media in ('video', 'audio')),
  duration_s int not null check (duration_s between 5 and 43200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((source = 'youtube' and yt_id is not null) or (source = 'upload' and path is not null))
);
alter table public.programs enable row level security;
drop policy if exists "programs: staff manage" on public.programs;
create policy "programs: staff manage" on public.programs for all to authenticated
  using (public.editor_role() in ('admin', 'editor')) with check (public.editor_role() in ('admin', 'editor'));
revoke all on public.programs from anon, authenticated;
grant select, insert, update, delete on public.programs to authenticated;

-- 3. Schedule: which programme starts when on which channel
create table if not exists public.schedule_items (
  id         uuid primary key default gen_random_uuid(),
  channel    text not null references public.live_channels (kind) on delete cascade on update cascade,
  program_id uuid not null references public.programs (id) on delete cascade,
  start_at   timestamptz not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null
);
create index if not exists schedule_items_channel_start on public.schedule_items (channel, start_at);
alter table public.schedule_items enable row level security;
drop policy if exists "schedule: staff manage" on public.schedule_items;
create policy "schedule: staff manage" on public.schedule_items for all to authenticated
  using (public.editor_role() in ('admin', 'editor')) with check (public.editor_role() in ('admin', 'editor'));
revoke all on public.schedule_items from anon, authenticated;
grant select, insert, update, delete on public.schedule_items to authenticated;

-- what visitors may read: the schedule from an hour ago to a week ahead
drop view if exists public.schedule_public;
create view public.schedule_public as
  select s.id, s.channel, s.start_at, s.start_at + make_interval(secs => p.duration_s) as end_at, now() as server_now,
         p.title, p.topic, p.source, p.yt_id, p.path, p.media, p.duration_s
  from public.schedule_items s join public.programs p on p.id = s.program_id
  where s.start_at + make_interval(secs => p.duration_s) > now() - interval '1 hour' and s.start_at < now() + interval '7 days';
grant select on public.schedule_public to anon, authenticated;

-- 4. Public storage for uploaded programmes (visitors must be able to play them). 50 MB per file is the free Supabase limit.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('programs', 'programs', true, 52428800,
        array['video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "programs: staff upload" on storage.objects;
create policy "programs: staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'programs' and public.editor_role() in ('admin', 'editor'));
drop policy if exists "programs: staff delete" on storage.objects;
create policy "programs: staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'programs' and public.editor_role() in ('admin', 'editor'));
