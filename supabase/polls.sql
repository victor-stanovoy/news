-- SparkNews visitor polls. Paste into Supabase > SQL Editor > New query > Run. Safe to run again.
-- Needs supabase/schema.sql to have been run first. Polls go live instantly (no website rebuild needed).

create table if not exists public.polls (
  id            uuid primary key default gen_random_uuid(),
  question      text not null check (char_length(trim(question)) between 3 and 300),
  description   text check (description is null or char_length(description) <= 600),
  display       text not null default 'widget' check (display in ('widget', 'banner')),     -- card inside the page, or full-screen banner
  placement     text not null default 'home'   check (placement in ('home', 'articles', 'all')),
  show_results  text not null default 'after_vote' check (show_results in ('after_vote', 'always', 'after_close')),
  allow_multiple boolean not null default false,
  status        text not null default 'draft' check (status in ('draft', 'live', 'closed')),
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create table if not exists public.poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.polls (id) on delete cascade,
  label    text not null check (char_length(trim(label)) between 1 and 120),
  position int not null default 0
);
create index if not exists poll_options_poll on public.poll_options (poll_id, position);
create table if not exists public.poll_votes (
  id         bigint generated always as identity primary key,
  poll_id    uuid not null references public.polls (id) on delete cascade,
  option_id  uuid not null references public.poll_options (id) on delete cascade,
  voter      text not null check (char_length(voter) between 16 and 64),    -- random id kept in the visitor's browser
  created_at timestamptz not null default now(),
  unique (poll_id, option_id, voter)
);
create index if not exists poll_votes_poll on public.poll_votes (poll_id);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
drop policy if exists "polls: staff manage" on public.polls;
create policy "polls: staff manage" on public.polls for all to authenticated
  using (public.editor_role() in ('admin', 'editor')) with check (public.editor_role() in ('admin', 'editor'));
drop policy if exists "poll_options: staff manage" on public.poll_options;
create policy "poll_options: staff manage" on public.poll_options for all to authenticated
  using (public.editor_role() in ('admin', 'editor')) with check (public.editor_role() in ('admin', 'editor'));
-- votes: nobody reads or writes the table directly; visitors vote through poll_vote() below
revoke all on public.polls, public.poll_options, public.poll_votes from anon, authenticated;
grant select, insert, update, delete on public.polls, public.poll_options to authenticated;

-- What visitors may see: live polls inside their time window, with their options.
create or replace function public.polls_active()
returns jsonb language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'question', p.question, 'description', p.description, 'display', p.display, 'placement', p.placement,
    'show_results', p.show_results, 'multiple', p.allow_multiple,
    'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by o.position, o.label), '[]'::jsonb)
                from public.poll_options o where o.poll_id = p.id)
  ) order by p.created_at desc), '[]'::jsonb)
  from public.polls p
  where p.status = 'live' and (p.starts_at is null or p.starts_at <= now()) and (p.ends_at is null or p.ends_at > now())
$$;

create or replace function public.poll_vote(p_poll uuid, p_options uuid[], p_voter text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.polls; n int;
begin
  select * into p from public.polls where id = p_poll;
  if not found or p.status <> 'live' or (p.starts_at is not null and p.starts_at > now()) or (p.ends_at is not null and p.ends_at <= now())
    then raise exception 'This poll is not open'; end if;
  if p_voter is null or char_length(p_voter) not between 16 and 64 then raise exception 'Bad voter id'; end if;
  p_options := (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(p_options, '{}')) x);
  n := coalesce(array_length(p_options, 1), 0);
  if n = 0 then raise exception 'Pick an answer'; end if;
  if n > 1 and not p.allow_multiple then raise exception 'Pick only one answer'; end if;
  if n > (select count(*) from public.poll_options where poll_id = p_poll and id = any (p_options)) then raise exception 'Unknown answer'; end if;
  if exists (select 1 from public.poll_votes where poll_id = p_poll and voter = p_voter) then raise exception 'You have already voted'; end if;
  insert into public.poll_votes (poll_id, option_id, voter) select p_poll, x, p_voter from unnest(p_options) x;
end $$;

-- Results: staff always; visitors when the poll's rule allows it (always / after they voted / after it closed).
-- Returns {"total": voters, "options": {option_id: votes}} or null when the visitor may not see results yet.
create or replace function public.poll_results(p_poll uuid, p_voter text default null)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare p public.polls; allowed boolean; r jsonb;
begin
  select * into p from public.polls where id = p_poll;
  if not found then return null; end if;
  allowed := public.editor_role() in ('admin', 'editor')
    or (p_voter is not null and exists (select 1 from public.poll_votes where poll_id = p_poll and voter = p_voter) and p.status in ('live', 'closed'))
    or (p.status = 'live' and p.show_results = 'always' and (p.starts_at is null or p.starts_at <= now()) and (p.ends_at is null or p.ends_at > now()))
    or (p.status = 'closed' and p.show_results in ('always', 'after_close'));
  if not coalesce(allowed, false) then return null; end if;
  select jsonb_build_object(
    'total', (select count(distinct voter) from public.poll_votes where poll_id = p_poll),
    'options', coalesce((select jsonb_object_agg(o.id::text, (select count(*) from public.poll_votes v where v.option_id = o.id))
                         from public.poll_options o where o.poll_id = p_poll), '{}'::jsonb)) into r;
  return r;
end $$;

grant execute on function public.polls_active() to anon, authenticated;
grant execute on function public.poll_vote(uuid, uuid[], text) to anon, authenticated;
grant execute on function public.poll_results(uuid, text) to anon, authenticated;
