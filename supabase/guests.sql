-- SparkNews TV guests: invite links and QR codes for guests who join from their own phone or computer.
-- Paste into Supabase > SQL Editor > New query > Run. Safe to run again. Needs supabase/schema.sql first.
-- Then redeploy the "livekit-token" Edge Function (README: TV guests).

create table if not exists public.guest_invites (
  code        text primary key,
  kind        text not null,
  label       text,
  max_devices integer not null default 4 check (max_devices between 1 and 12),
  expires_at  timestamptz not null,
  revoked     boolean not null default false,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
alter table public.guest_invites enable row level security;
revoke all on public.guest_invites from anon, authenticated;
grant select on public.guest_invites to service_role;       -- only the livekit-token function reads invites

create or replace function public.guest_invite_create(p_kind text, p_label text, p_hours integer, p_max integer)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if public.editor_role() not in ('admin', 'editor') then raise exception 'Only editors and admins can invite guests'; end if;
  if p_kind !~ '^[a-z0-9][a-z0-9-]{1,30}$' then raise exception 'Unknown channel'; end if;
  c := replace(gen_random_uuid()::text, '-', '');
  insert into public.guest_invites (code, kind, label, max_devices, expires_at)
  values (c, p_kind, left(coalesce(p_label, ''), 60), greatest(1, least(coalesce(p_max, 4), 12)), now() + make_interval(hours => greatest(1, least(coalesce(p_hours, 4), 168))));
  return c;
end $$;

create or replace function public.guest_invite_list(p_kind text)
returns table (code text, label text, max_devices integer, expires_at timestamptz, revoked boolean)
language plpgsql security definer stable set search_path = public as $$
begin
  if public.editor_role() not in ('admin', 'editor') then raise exception 'Only editors and admins can see invites'; end if;
  return query select g.code, g.label, g.max_devices, g.expires_at, g.revoked from public.guest_invites g
    where g.kind = p_kind and g.expires_at > now() - interval '1 day' order by g.created_at desc limit 20;
end $$;

create or replace function public.guest_invite_revoke(p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.editor_role() not in ('admin', 'editor') then raise exception 'Only editors and admins can change invites'; end if;
  update public.guest_invites set revoked = true where code = p_code;
end $$;

revoke execute on function public.guest_invite_create(text, text, integer, integer), public.guest_invite_list(text), public.guest_invite_revoke(text) from public, anon;
grant execute on function public.guest_invite_create(text, text, integer, integer), public.guest_invite_list(text), public.guest_invite_revoke(text) to authenticated;
