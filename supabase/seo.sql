-- SparkNews: per-article search engine fields (title, description, keywords).
-- Run once in the Supabase SQL Editor. Safe to run again. Without it the website still builds; the editor's
-- "Search engines (SEO)" box on an article then simply has nowhere to save and the fields are ignored.
alter table public.articles add column if not exists seo_title       text;
alter table public.articles add column if not exists seo_description text;
alter table public.articles add column if not exists seo_keywords    text;

-- if privacy.sql restricted the public columns, let the website build read these too
do $$ begin
  if not has_table_privilege('anon', 'public.articles', 'select') then
    execute 'grant select (seo_title, seo_description, seo_keywords) on public.articles to anon';
  end if;
end $$;
