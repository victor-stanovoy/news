-- SparkNews partners and embeds. Paste into Supabase > SQL Editor > New query > Run. Safe to run again.
-- Run after schema.sql, live.sql (and privacy.sql if you use it). Lets you put a partner label on an article or a broadcast.

alter table public.articles add column if not exists partner_label text;
alter table public.articles drop constraint if exists articles_partner_label_ok;
alter table public.articles add constraint articles_partner_label_ok check (partner_label is null or partner_label ~ '^[a-z0-9-]{1,40}$');

alter table public.articles add column if not exists partner_mode text;
alter table public.articles drop constraint if exists articles_partner_mode_ok;
alter table public.articles add constraint articles_partner_mode_ok check (partner_mode is null or partner_mode in ('redirect', 'hide', 'show'));

-- if privacy.sql restricted the public columns, let visitors read this one too
do $$ begin
  if not has_table_privilege('anon', 'public.articles', 'select') then
    execute 'grant select (partner_label, partner_mode) on public.articles to anon';
  end if;
end $$;

alter table public.live_channels add column if not exists label text;
alter table public.live_channels drop constraint if exists live_channels_label_ok;
alter table public.live_channels add constraint live_channels_label_ok check (label is null or label ~ '^[a-z0-9-]{1,40}$');

drop function if exists public.live_set(text, text, boolean);
create or replace function public.live_set(p_kind text, p_title text, p_on boolean, p_label text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.editor_role() not in ('admin', 'editor') then raise exception 'Only editors and admins can go live'; end if;
  if p_kind not in ('radio', 'tv') then raise exception 'Unknown channel'; end if;
  update public.live_channels set
    on_air = p_on, title = case when p_on then nullif(trim(p_title), '') else title end,
    label = case when p_on then nullif(trim(p_label), '') else label end,
    started_at = case when p_on then now() else started_at end,
    heartbeat = case when p_on then now() else heartbeat end,
    started_by = case when p_on then auth.uid() else started_by end
  where kind = p_kind;
end $$;
grant execute on function public.live_set(text, text, boolean, text) to authenticated;

drop view if exists public.live_now;
create view public.live_now as
  select kind, title, started_at, now_playing, label from public.live_channels
  where on_air and heartbeat > now() - interval '90 seconds';
grant select on public.live_now to anon, authenticated;
