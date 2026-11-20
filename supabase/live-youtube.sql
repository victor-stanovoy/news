-- SparkNews: play a YouTube video on air during a live broadcast.
-- Paste into Supabase > SQL Editor > New query > Run. Safe to run again.
-- Needs supabase/live.sql (and supabase/partners.sql if you use it) to have been run first.
--
-- How it works: the studio saves the video code here; visitors who are watching get YouTube's official embed player
-- (with sound) on top of the picture, started at the right second. Your voice keeps playing underneath.

alter table public.live_channels add column if not exists yt_id text;
alter table public.live_channels add column if not exists yt_started_at timestamptz;

-- what visitors may read: the same as before, plus the video and the server clock (so everybody starts at the same second)
drop view if exists public.live_now;
create view public.live_now as
  select kind, title, started_at, now_playing, label, yt_id, yt_started_at, now() as server_now
  from public.live_channels
  where on_air and heartbeat > now() - interval '90 seconds';
grant select on public.live_now to anon, authenticated;

-- going on or off air always clears the video
create or replace function public.live_set(p_kind text, p_title text, p_on boolean, p_label text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.editor_role() not in ('admin', 'editor') then raise exception 'Only editors and admins can go live'; end if;
  if not exists (select 1 from public.live_channels where kind = p_kind) then raise exception 'Unknown channel'; end if;
  update public.live_channels set
    on_air = p_on, title = case when p_on then nullif(trim(p_title), '') else title end,
    label = case when p_on then nullif(trim(p_label), '') else label end,
    started_at = case when p_on then now() else started_at end,
    heartbeat = case when p_on then now() else heartbeat end,
    started_by = case when p_on then auth.uid() else started_by end,
    yt_id = null, yt_started_at = null
  where kind = p_kind;
end $$;
revoke execute on function public.live_set(text, text, boolean, text) from public, anon;
grant execute on function public.live_set(text, text, boolean, text) to authenticated;

-- start (p_id = the 11-character video code) or stop (p_id empty) the video; only the person who is on air can do it
create or replace function public.live_youtube(p_kind text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.editor_role() not in ('admin', 'editor') then raise exception 'Only editors and admins can go live'; end if;
  if coalesce(p_id, '') <> '' and p_id !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'That is not a YouTube video code'; end if;
  update public.live_channels set
    yt_id = nullif(p_id, ''),
    yt_started_at = case when coalesce(p_id, '') = '' then null else now() end
  where kind = p_kind and on_air and started_by = auth.uid();
  if not found then raise exception 'You are not on air on this channel'; end if;
end $$;
revoke execute on function public.live_youtube(text, text) from public, anon;
grant execute on function public.live_youtube(text, text) to authenticated;
