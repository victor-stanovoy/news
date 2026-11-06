-- SparkNews live radio and live TV (LiveKit). Paste into Supabase > SQL Editor > New query > Run. Safe to run again.
-- Needs supabase/schema.sql to have been run first.

create table if not exists public.live_channels (
  kind       text primary key check (kind in ('radio', 'tv')),
  title      text,
  on_air     boolean not null default false,
  started_at timestamptz,
  heartbeat  timestamptz,
  started_by uuid references auth.users (id) on delete set null
);
insert into public.live_channels (kind) values ('radio'), ('tv') on conflict do nothing;
alter table public.live_channels enable row level security;      -- no policies: only the functions below touch it
revoke all on public.live_channels from anon, authenticated;

-- What visitors may see: a channel counts as live only while its editor's page keeps sending a heartbeat,
-- so closing the browser or losing the connection takes it off air by itself within 90 seconds.
create or replace view public.live_now as
  select kind, title, started_at from public.live_channels
  where on_air and heartbeat > now() - interval '90 seconds';
grant select on public.live_now to anon, authenticated;

create or replace function public.live_set(p_kind text, p_title text, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.editor_role() not in ('admin', 'editor') then raise exception 'Only editors and admins can go live'; end if;
  if p_kind not in ('radio', 'tv') then raise exception 'Unknown channel'; end if;
  update public.live_channels set
    on_air = p_on, title = case when p_on then nullif(trim(p_title), '') else title end,
    started_at = case when p_on then now() else started_at end,
    heartbeat = case when p_on then now() else heartbeat end,
    started_by = case when p_on then auth.uid() else started_by end
  where kind = p_kind;
end $$;

create or replace function public.live_beat(p_kind text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.editor_role() not in ('admin', 'editor') then raise exception 'Only editors and admins can go live'; end if;
  update public.live_channels set heartbeat = now() where kind = p_kind and on_air and started_by = auth.uid();
end $$;

revoke execute on function public.live_set(text, text, boolean), public.live_beat(text) from public, anon;
grant execute on function public.live_set(text, text, boolean), public.live_beat(text) to authenticated;
