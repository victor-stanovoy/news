-- SparkNews: "Sparks" (quick reads). Run once in the Supabase SQL Editor. Safe to run again.
-- Adds the Format choice to articles. Without it the website still builds; the editor's Format box has nowhere to save.
alter table public.articles add column if not exists article_format text not null default 'article';

do $$ begin
  if not has_table_privilege('anon', 'public.articles', 'select') then
    execute 'grant select (article_format) on public.articles to anon';
  end if;
end $$;
