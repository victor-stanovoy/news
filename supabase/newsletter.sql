-- SparkNews newsletter: subscribers, saved newsletters and send log.
-- Paste into Supabase > SQL Editor > New query > Run. Safe to run again.
-- Needs supabase/schema.sql and supabase/settings.sql first.

create table if not exists public.subscribers (
  id                uuid primary key default gen_random_uuid(),
  email             text not null check (length(email) between 5 and 254),
  name              text,
  status            text not null default 'pending' check (status in ('pending', 'confirmed', 'unsubscribed')),
  token             text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  source            text,
  created_at        timestamptz not null default now(),
  confirmed_at      timestamptz,
  unsubscribed_at   timestamptz,
  last_confirm_sent timestamptz
);
create unique index if not exists subscribers_email_uq on public.subscribers (lower(email));
create index if not exists subscribers_status_idx on public.subscribers (status);

create table if not exists public.newsletters (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null default '',
  preheader   text,
  mode        text not null default 'template' check (mode in ('template', 'html')),
  state       jsonb not null default '{}'::jsonb,   -- everything the composer needs to reopen it
  html        text,                                 -- the final email as it was sent / last previewed
  status      text not null default 'draft' check (status in ('draft', 'sending', 'sent')),
  sent_at     timestamptz,
  sent_count  integer not null default 0,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.newsletter_sends (
  newsletter_id uuid not null references public.newsletters (id) on delete cascade,
  subscriber_id uuid not null references public.subscribers (id) on delete cascade,
  sent_at       timestamptz not null default now(),
  primary key (newsletter_id, subscriber_id)
);

alter table public.subscribers enable row level security;
alter table public.newsletters enable row level security;
alter table public.newsletter_sends enable row level security;

drop policy if exists "subscribers: staff manage" on public.subscribers;
create policy "subscribers: staff manage" on public.subscribers for all to authenticated
  using (public.editor_role() in ('admin', 'editor')) with check (public.editor_role() in ('admin', 'editor'));
drop policy if exists "newsletters: staff manage" on public.newsletters;
create policy "newsletters: staff manage" on public.newsletters for all to authenticated
  using (public.editor_role() in ('admin', 'editor')) with check (public.editor_role() in ('admin', 'editor'));
drop policy if exists "sends: staff read" on public.newsletter_sends;
create policy "sends: staff read" on public.newsletter_sends for select to authenticated
  using (public.editor_role() in ('admin', 'editor'));

revoke all on public.subscribers, public.newsletters, public.newsletter_sends from anon, authenticated;
grant select, insert, update, delete on public.subscribers, public.newsletters to authenticated;
grant select on public.newsletter_sends to authenticated;
-- visitors never touch these tables: signing up, confirming and unsubscribing go through the "newsletter" function
grant all on public.subscribers, public.newsletters, public.newsletter_sends to service_role;
