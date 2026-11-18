-- SparkNews staff ID badges. Paste into Supabase > SQL Editor > New query > Run. Safe to run again.
-- Needs supabase/schema.sql to have been run first. Only admins can see or change badges.
-- The public verify page (badge/index.html on your website) can only look up ONE badge by its secret token.

create table if not exists public.badges (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique default replace(gen_random_uuid()::text, '-', ''),   -- secret part of the QR link
  name        text not null check (char_length(trim(name)) between 1 and 120),
  role        text check (role is null or char_length(role) <= 120),
  employee_no text check (employee_no is null or char_length(employee_no) <= 40),
  photo_url   text check (photo_url is null or char_length(photo_url) <= 600),
  active      boolean not null default true,        -- off = the QR link stops verifying (lost or ended badge)
  created_at  timestamptz not null default now()
);

alter table public.badges enable row level security;
drop policy if exists "badges: admin manage" on public.badges;
create policy "badges: admin manage" on public.badges for all to authenticated
  using (public.editor_role() = 'admin') with check (public.editor_role() = 'admin');
revoke all on public.badges from anon, authenticated;
grant select, insert, update, delete on public.badges to authenticated;

-- What the verify page may learn: only the badge whose token it holds, and only while it is active.
create or replace function public.badge_lookup(p_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object('name', b.name, 'role', b.role, 'employee_no', b.employee_no, 'photo_url', b.photo_url)
  from public.badges b
  where b.active and p_token is not null and char_length(p_token) between 16 and 64 and b.token = p_token
$$;
revoke execute on function public.badge_lookup(text) from public;
grant execute on function public.badge_lookup(text) to anon, authenticated;
