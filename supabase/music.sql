-- SparkNews music and jingle library for the radio / TV studios.
-- Paste into Supabase > SQL Editor > New query > Run. Safe to run again. Needs supabase/schema.sql first.

create table if not exists public.tracks (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  path       text not null unique,
  kind       text not null default 'music' check (kind in ('music', 'jingle')),
  size       bigint,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.tracks enable row level security;
drop policy if exists "tracks: staff manage" on public.tracks;
create policy "tracks: staff manage" on public.tracks for all to authenticated
  using (public.editor_role() in ('admin', 'editor')) with check (public.editor_role() in ('admin', 'editor'));
grant select, insert, update, delete on public.tracks to authenticated;

-- private bucket: the files are only reachable through short-lived links that editors request (visitors never get them)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', false, 52428800,
        array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/flac'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "audio: staff read" on storage.objects;
create policy "audio: staff read" on storage.objects for select to authenticated
  using (bucket_id = 'audio' and public.editor_role() in ('admin', 'editor'));
drop policy if exists "audio: staff upload" on storage.objects;
create policy "audio: staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and public.editor_role() in ('admin', 'editor'));
drop policy if exists "audio: staff delete" on storage.objects;
create policy "audio: staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'audio' and public.editor_role() in ('admin', 'editor'));
