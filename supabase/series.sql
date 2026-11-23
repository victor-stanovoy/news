-- SparkNews series (playlists of articles). Run once in the Supabase SQL Editor. Safe to run again.
-- Needs schema.sql first. Articles point at a series with articles.series_id (the series slug) and articles.series_order.
create table if not exists public.article_series (
  slug        text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  title       text not null check (char_length(trim(title)) between 2 and 120),
  description text check (description is null or char_length(description) <= 600),
  image_url   text,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.article_series enable row level security;
drop policy if exists "series: public read" on public.article_series;
create policy "series: public read" on public.article_series for select to anon, authenticated using (true);
drop policy if exists "series: staff manage" on public.article_series;
create policy "series: staff manage" on public.article_series for all to authenticated
  using (public.editor_role() in ('admin', 'editor')) with check (public.editor_role() in ('admin', 'editor'));
grant select on public.article_series to anon, authenticated;
grant insert, update, delete on public.article_series to authenticated;
