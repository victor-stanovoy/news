-- SparkNews TV studio picture and video library: things you can show to the audience during a live TV broadcast.
-- Paste into Supabase > SQL Editor > New query > Run. Safe to run again. Needs supabase/schema.sql first.

create table if not exists public.tv_media (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  path       text not null unique,
  kind       text not null check (kind in ('image', 'video')),
  size       bigint,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.tv_media enable row level security;
drop policy if exists "tv_media: staff manage" on public.tv_media;
create policy "tv_media: staff manage" on public.tv_media for all to authenticated
  using (public.editor_role() in ('admin', 'editor')) with check (public.editor_role() in ('admin', 'editor'));
grant select, insert, update, delete on public.tv_media to authenticated;

-- private bucket (50 MB per file is the free Supabase limit): only editors get short-lived links
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tvmedia', 'tvmedia', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "tvmedia: staff read" on storage.objects;
create policy "tvmedia: staff read" on storage.objects for select to authenticated
  using (bucket_id = 'tvmedia' and public.editor_role() in ('admin', 'editor'));
drop policy if exists "tvmedia: staff upload" on storage.objects;
create policy "tvmedia: staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'tvmedia' and public.editor_role() in ('admin', 'editor'));
drop policy if exists "tvmedia: staff delete" on storage.objects;
create policy "tvmedia: staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'tvmedia' and public.editor_role() in ('admin', 'editor'));
