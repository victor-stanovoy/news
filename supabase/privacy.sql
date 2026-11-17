-- SparkNews author privacy (GDPR for your team). Paste into Supabase > SQL Editor > New query > Run. Safe to run again.
-- Run it AFTER schema.sql, and again whenever you re-run schema.sql (schema.sql re-opens the table to visitors).
--
-- What it does: the public (anon) key can no longer read who wrote an article. Names of authors/editors and the
-- internal user ids (created_by, updated_by) are hidden from anyone who is not signed in to the editor, even if
-- someone calls the database API directly. The website can only get author names through article_authors(),
-- which returns nothing while "Hide author and editor names" (Settings > Privacy) or Lockdown mode is on.

revoke select on public.articles from anon;
do $$ declare cols text; begin
  select string_agg(quote_ident(column_name), ', ') into cols from information_schema.columns
   where table_schema = 'public' and table_name = 'articles' and column_name not in ('author_name', 'author_verified', 'created_by', 'updated_by');
  execute 'grant select (' || cols || ') on public.articles to anon';
end $$;

create or replace function public.article_authors()
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare d jsonb; hide boolean;
begin
  select data into d from public.site_settings where id = 1;
  hide := coalesce((d #>> '{privacy,hide_authors}')::boolean, false) or coalesce((d #>> '{privacy,lockdown}')::boolean, false);
  if hide then return '{}'::jsonb; end if;
  return coalesce((select jsonb_object_agg(a.id, jsonb_build_object('name', a.author_name, 'verified', coalesce(a.author_verified, false)))
                   from public.articles a
                   where a.status = 'published' and not coalesce(a.taken_down, false) and a.author_name is not null), '{}'::jsonb);
end $$;
grant execute on function public.article_authors() to anon, authenticated;
