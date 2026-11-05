-- SparkNews: update the website right after an article is published, edited, unpublished or deleted.
--
-- Without this file the site only rebuilds when code is pushed to GitHub (and on an unreliable timer), so a published
-- article could take hours to appear. With it, the database asks GitHub to rebuild the site within seconds.
--
-- BEFORE RUNNING: replace PASTE_TOKEN_HERE (line marked <<<) with a GitHub token that may ONLY start workflows:
--   GitHub > your profile picture > Settings > Developer settings > Personal access tokens > Fine-grained tokens
--   > Generate new token. Name: SparkNews rebuild. Expiration: the longest offered. Repository access: Only select
--   repositories > "news". Repository permissions > Actions: Read and write (leave everything else at "No access").
--   Generate, copy the token (it starts with github_pat_) and paste it below.
-- The token is kept in a table the website and the editor cannot read. Safe to run again: it never overwrites a
-- saved token with the placeholder.

create extension if not exists pg_net with schema extensions;

create table if not exists public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;     -- no policies: invisible to the website and the editor
revoke all on public.app_secrets from anon, authenticated;

insert into public.app_secrets (key, value) values ('github_token', 'PASTE_TOKEN_HERE')   -- <<< put your token here
on conflict (key) do update set value = excluded.value where excluded.value <> 'PASTE_TOKEN_HERE';

-- starts the "Build and deploy site" workflow on GitHub; returns false when no token is saved yet
create or replace function public.fire_rebuild()
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare tok text;
begin
  select value into tok from public.app_secrets where key = 'github_token';
  if tok is null or tok = '' or tok = 'PASTE_TOKEN_HERE' then return false; end if;
  perform net.http_post(
    url     := 'https://api.github.com/repos/victor-stanovoy/news/actions/workflows/pages.yml/dispatches',
    headers := jsonb_build_object('Authorization', 'Bearer ' || tok, 'Accept', 'application/vnd.github+json',
                                  'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'sparknews-db',
                                  'Content-Type', 'application/json'),
    body    := '{"ref":"main"}'::jsonb);
  return true;
end $$;
revoke all on function public.fire_rebuild() from public, anon, authenticated;

-- after every change a person makes to a live (or just-unpublished) article
create or replace function public.notify_rebuild()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare st_old text; st_new text;
begin
  if auth.uid() is null then return null; end if;           -- imports and direct database work do not trigger rebuilds
  if tg_op <> 'INSERT' then st_old := old.status; end if;
  if tg_op <> 'DELETE' then st_new := new.status; end if;
  if coalesce(st_old, '') in ('published', 'scheduled') or coalesce(st_new, '') in ('published', 'scheduled') then
    perform public.fire_rebuild();
  end if;
  return null;
end $$;
revoke all on function public.notify_rebuild() from public, anon, authenticated;

drop trigger if exists articles_rebuild on public.articles;
create trigger articles_rebuild after insert or update or delete on public.articles
  for each row execute function public.notify_rebuild();

-- used by the editor: the "Update website" button, and to know whether automatic updates are set up
create or replace function public.rebuild_configured()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.app_secrets where key = 'github_token' and value not in ('', 'PASTE_TOKEN_HERE'))
$$;

create or replace function public.rebuild_site()
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if coalesce(public.editor_role(), '') not in ('admin', 'editor') then
    raise exception 'Only editors and admins can update the website';
  end if;
  if public.fire_rebuild() then return 'started'; end if;
  return 'not configured';
end $$;

revoke execute on function public.rebuild_configured(), public.rebuild_site() from public, anon;
grant execute on function public.rebuild_configured(), public.rebuild_site() to authenticated;
