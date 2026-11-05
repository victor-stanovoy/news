-- SparkNews database schema for Supabase.
-- Paste this whole file into Supabase > SQL Editor > New query > Run. It is safe to run more than once.

-- ---------------------------------------------------------------- editors (who may log in to the editor)
create table if not exists public.editors (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role    text not null check (role in ('admin', 'editor', 'writer')),
  name    text
);
-- admin  = everything, including deleting articles and full-HTML articles
-- editor = create, edit and publish any article
-- writer = create and edit their own drafts only (cannot publish)

create or replace function public.editor_role()
returns text language sql security definer stable set search_path = public as $$
  select role from public.editors where user_id = auth.uid()
$$;

alter table public.editors enable row level security;
drop policy if exists "editors: read own role" on public.editors;
create policy "editors: read own role" on public.editors for select to authenticated
  using (user_id = auth.uid() or public.editor_role() = 'admin');
drop policy if exists "editors: admins manage" on public.editors;
create policy "editors: admins manage" on public.editors for all to authenticated
  using (public.editor_role() = 'admin') with check (public.editor_role() = 'admin');

-- ---------------------------------------------------------------- team management (the "Team" panel in the editor)
-- Only admins can use these. A person must have an account first: they open the editor and ask for a login link.
create or replace function public.team_list()
returns table (user_id uuid, email text, role text, name text)
language plpgsql security definer stable set search_path = public as $$
begin
  if public.editor_role() is distinct from 'admin' then raise exception 'Admins only'; end if;
  return query select e.user_id, u.email::text, e.role, e.name
               from public.editors e join auth.users u on u.id = e.user_id order by e.role, u.email;
end $$;

create or replace function public.team_set(p_email text, p_role text, p_name text default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if public.editor_role() is distinct from 'admin' then raise exception 'Admins only'; end if;
  if p_role not in ('admin', 'editor', 'writer') then raise exception 'Unknown role'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then
    raise exception 'No account with that email yet. Ask them to open the editor and request a login link first.';
  end if;
  if p_role <> 'admin' and exists (select 1 from public.editors where user_id = uid and role = 'admin')
     and (select count(*) from public.editors where role = 'admin') <= 1 then
    raise exception 'There must always be at least one admin';
  end if;
  insert into public.editors (user_id, role, name) values (uid, p_role, nullif(trim(p_name), ''))
  on conflict (user_id) do update set role = excluded.role, name = coalesce(excluded.name, public.editors.name);
end $$;

create or replace function public.team_remove(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.editor_role() is distinct from 'admin' then raise exception 'Admins only'; end if;
  if exists (select 1 from public.editors where user_id = p_user and role = 'admin')
     and (select count(*) from public.editors where role = 'admin') <= 1 then
    raise exception 'There must always be at least one admin';
  end if;
  delete from public.editors where user_id = p_user;
end $$;

revoke execute on function public.team_list(), public.team_set(text, text, text), public.team_remove(uuid) from public, anon;
grant execute on function public.team_list(), public.team_set(text, text, text), public.team_remove(uuid) to authenticated;

-- ---------------------------------------------------------------- articles
create table if not exists public.articles (
  id                    text primary key default gen_random_uuid()::text,
  slug                  text unique,
  title                 text not null,
  subtitle              text,
  content               text,
  content_type          text default 'rich',
  category              text not null default 'News',
  image_url             text,
  cover_focus_x         integer default 50,
  cover_focus_y         integer default 50,
  additional_images     jsonb  default '[]'::jsonb,
  image_layout          text default 'grid',
  reporter_video_url    text,
  author_name           text,
  author_verified       boolean default false,
  status                text not null default 'draft' check (status in ('draft', 'published', 'scheduled')),
  taken_down            boolean default false,
  is_breaking           boolean default false,
  breaking_description  text,
  published_at          timestamptz,
  scheduled_publish_at  timestamptz,
  is_ai_translated      boolean default false,
  is_featured           boolean default false,
  views                 integer default 0,
  is_live_update        boolean default false,
  live_update_label     text,
  live_updates          jsonb default '[]'::jsonb,
  citations             text,
  series_id             text,
  series_order          integer,
  translations          jsonb default '{}'::jsonb,
  created_by            uuid references auth.users (id) on delete set null,
  updated_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- a slug becomes a file name on the website, so it must never contain a path
alter table public.articles drop constraint if exists articles_slug_safe;
alter table public.articles add constraint articles_slug_safe
  check (slug is null or (slug !~ '[/\\.\s]' and length(slug) between 1 and 100));
create index if not exists articles_status_idx on public.articles (status, published_at desc);

-- keep timestamps / authorship honest, and keep script-capable HTML articles admin-only
create or replace function public.articles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.editor_role();
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
    if tg_op = 'INSERT' then new.created_by := auth.uid(); else new.created_by := old.created_by; end if;
    if new.content_type in ('html', 'interactive') and coalesce(r, '') <> 'admin'
       and (tg_op = 'INSERT' or new.content is distinct from old.content or new.content_type is distinct from old.content_type) then
      raise exception 'Only admins can create or change full-HTML / interactive articles';
    end if;
  end if;
  -- Edits made in the editor always stamp "now". Imports and direct database work (no logged-in user)
  -- may supply their own date, so old articles keep their real "updated" date.
  if auth.uid() is not null or tg_op = 'UPDATE' and new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists articles_guard on public.articles;
create trigger articles_guard before insert or update on public.articles
  for each row execute function public.articles_guard();

alter table public.articles enable row level security;

drop policy if exists "articles: public reads live ones" on public.articles;
create policy "articles: public reads live ones" on public.articles for select to anon, authenticated
  using (coalesce(taken_down, false) = false
         and (status = 'published' or (status = 'scheduled' and scheduled_publish_at <= now())));

drop policy if exists "articles: staff read" on public.articles;
create policy "articles: staff read" on public.articles for select to authenticated
  using (public.editor_role() in ('admin', 'editor') or (public.editor_role() = 'writer' and created_by = auth.uid()));

drop policy if exists "articles: staff insert" on public.articles;
create policy "articles: staff insert" on public.articles for insert to authenticated
  with check (public.editor_role() in ('admin', 'editor') or (public.editor_role() = 'writer' and status = 'draft'));

drop policy if exists "articles: staff update" on public.articles;
create policy "articles: staff update" on public.articles for update to authenticated
  using (public.editor_role() in ('admin', 'editor') or (public.editor_role() = 'writer' and created_by = auth.uid() and status = 'draft'))
  with check (public.editor_role() in ('admin', 'editor') or (public.editor_role() = 'writer' and status = 'draft'));

drop policy if exists "articles: admins delete" on public.articles;
create policy "articles: admins delete" on public.articles for delete to authenticated
  using (public.editor_role() = 'admin');

-- The website build asks for the ids of ALL articles (ids only, no content) so an article that is hidden here
-- (draft, taken down, scheduled) can never come back from an old CSV copy.
create or replace function public.known_article_ids()
returns setof text language sql security definer stable set search_path = public as $$
  select id from public.articles
$$;
grant execute on function public.known_article_ids() to anon, authenticated;

-- ---------------------------------------------------------------- permissions
-- Newer Supabase projects do not give the public roles access to new tables automatically, so it is granted here.
-- This only opens the door to the tables: what each person may actually read or change is decided by the
-- row-level security policies above (anonymous visitors can only ever see live articles).
grant usage on schema public to anon, authenticated;
grant select on public.articles to anon, authenticated;
grant insert, update, delete on public.articles to authenticated;
grant select, insert, update, delete on public.editors to authenticated;
grant execute on function public.editor_role() to anon, authenticated;
grant execute on function public.known_article_ids() to anon, authenticated;

-- ---------------------------------------------------------------- image uploads
insert into storage.buckets (id, name, public) values ('images', 'images', true) on conflict (id) do nothing;

drop policy if exists "images: anyone can view" on storage.objects;
create policy "images: anyone can view" on storage.objects for select to anon, authenticated
  using (bucket_id = 'images');
drop policy if exists "images: staff upload" on storage.objects;
create policy "images: staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'images' and public.editor_role() is not null);

-- ---------------------------------------------------------------- OPTIONAL: rebuild the website whenever a live article changes
-- Without this the site still rebuilds every hour. To make it instant, run the block below once, after
-- replacing PASTE_GITHUB_TOKEN with a fine-grained GitHub token limited to the "news" repository with
-- "Contents: Read and write" permission. The token is stored in a table that browsers cannot read.
create table if not exists public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;   -- no policies = invisible to the website and the editor
revoke all on public.app_secrets from anon, authenticated;

create or replace function public.notify_rebuild()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare tok text; st_old text; st_new text;
begin
  select value into tok from public.app_secrets where key = 'github_token';
  if tok is null or tok = '' or tok = 'PASTE_GITHUB_TOKEN' then return null; end if;
  if tg_op <> 'INSERT' then st_old := old.status; end if;
  if tg_op <> 'DELETE' then st_new := new.status; end if;
  if coalesce(st_old, '') in ('published', 'scheduled') or coalesce(st_new, '') in ('published', 'scheduled') then
    perform net.http_post(
      url     := 'https://api.github.com/repos/victor-stanovoy/news/dispatches',
      headers := jsonb_build_object('Authorization', 'Bearer ' || tok, 'Accept', 'application/vnd.github+json',
                                    'User-Agent', 'sparknews-db', 'Content-Type', 'application/json'),
      body    := '{"event_type":"articles-changed"}'::jsonb);
  end if;
  return null;
end $$;

-- uncomment the next two lines (and put in your token) to switch the instant rebuild on:
-- create extension if not exists pg_net with schema extensions;
-- insert into public.app_secrets (key, value) values ('github_token', 'PASTE_GITHUB_TOKEN') on conflict (key) do update set value = excluded.value;
-- drop trigger if exists articles_rebuild on public.articles;
-- create trigger articles_rebuild after insert or update or delete on public.articles for each row execute function public.notify_rebuild();
