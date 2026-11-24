-- SparkNews archives: a PUBLIC archive (anyone can open it on the website) and a STAFF archive (only people you allow).
-- Run once in the Supabase SQL Editor. Safe to run again. Needs schema.sql first.
-- The staff archive is protected by the database itself, not by hiding a page: without a login and the right access, the rows are never sent.

alter table public.editors add column if not exists archive_access boolean not null default true;

create table if not exists public.archive_items (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null default 'staff' check (scope in ('public', 'staff')),
  title       text not null check (char_length(trim(title)) between 2 and 200),
  description text check (description is null or char_length(description) <= 2000),
  url         text check (url is null or url ~* '^https?://'),
  kind        text not null default 'document' check (kind in ('document', 'issue', 'photo', 'video', 'audio', 'other')),
  year        int check (year is null or year between 1900 and 2200),
  tags        text,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists archive_items_scope_idx on public.archive_items (scope, year desc);
alter table public.archive_items enable row level security;

create or replace function public.archive_allowed()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select e.archive_access from public.editors e where e.user_id = auth.uid()), false)
$$;
grant execute on function public.archive_allowed() to authenticated;

drop policy if exists "archive: public items are public" on public.archive_items;
create policy "archive: public items are public" on public.archive_items for select to anon, authenticated using (scope = 'public');
drop policy if exists "archive: staff read all" on public.archive_items;
create policy "archive: staff read all" on public.archive_items for select to authenticated using (public.archive_allowed());
drop policy if exists "archive: editors manage" on public.archive_items;
create policy "archive: editors manage" on public.archive_items for all to authenticated
  using (public.editor_role() in ('admin', 'editor') and public.archive_allowed())
  with check (public.editor_role() in ('admin', 'editor') and public.archive_allowed());

revoke all on public.archive_items from anon, authenticated;
grant select on public.archive_items to anon;
grant select, insert, update, delete on public.archive_items to authenticated;

-- admins choose who may open the staff archive (Archive window in the editor)
create or replace function public.archive_access_set(p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.editor_role() is distinct from 'admin' then raise exception 'Admins only'; end if;
  update public.editors set archive_access = p_on where user_id = p_user;
end $$;
revoke execute on function public.archive_access_set(uuid, boolean) from public, anon;
grant execute on function public.archive_access_set(uuid, boolean) to authenticated;

create or replace function public.archive_team()
returns table (user_id uuid, email text, role text, name text, archive_access boolean)
language plpgsql security definer stable set search_path = public as $$
begin
  if public.editor_role() is distinct from 'admin' then raise exception 'Admins only'; end if;
  return query select e.user_id, u.email::text, e.role, e.name, e.archive_access from public.editors e join auth.users u on u.id = e.user_id order by e.role, u.email;
end $$;
revoke execute on function public.archive_team() from public, anon;
grant execute on function public.archive_team() to authenticated;

-- public items appear on the website after a rebuild: trigger one when instant updates are set up
create or replace function public.archive_rebuild()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then return null; end if;
  if (tg_op <> 'INSERT' and old.scope = 'public') or (tg_op <> 'DELETE' and new.scope = 'public') then
    begin
      if to_regprocedure('public.fire_rebuild()') is not null then execute 'select public.fire_rebuild()'; end if;
    exception when others then null;
    end;
  end if;
  return null;
end $$;
revoke all on function public.archive_rebuild() from public, anon, authenticated;
drop trigger if exists archive_items_rebuild on public.archive_items;
create trigger archive_items_rebuild after insert or update or delete on public.archive_items
  for each row execute function public.archive_rebuild();
