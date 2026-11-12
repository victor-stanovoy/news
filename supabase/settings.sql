-- SparkNews settings panel: lets admins change site settings and the LiveKit / GitHub keys from the editor.
-- Paste into Supabase > SQL Editor > New query > Run. Safe to run again. Needs supabase/schema.sql first.

-- keys and tokens (also used by supabase/instant-rebuild.sql). Invisible to the website and the editor pages;
-- only the security-definer functions below and the livekit-token function can touch it.
create table if not exists public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
grant select on public.app_secrets to service_role;

-- ordinary site settings (public: they only hold things like the site name and ticker options)
create table if not exists public.site_settings (
  id         integer primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
insert into public.site_settings (id) values (1) on conflict do nothing;
alter table public.site_settings enable row level security;
drop policy if exists "settings: public read" on public.site_settings;
create policy "settings: public read" on public.site_settings for select to anon, authenticated using (true);
revoke all on public.site_settings from anon, authenticated;
grant select on public.site_settings to anon, authenticated;     -- writing only through settings_save()

create or replace function public.settings_save(p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare clean jsonb;
begin
  if public.editor_role() is distinct from 'admin' then raise exception 'Only admins can change settings'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Settings must be an object'; end if;
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into clean from jsonb_each(p_data) as t(k, v)
   where k = any (array['site_name','logo_left','logo_right','tagline','language','base_url','footer_text','nav_max','nav_order',
                        'home_category_sections','most_read_count','breaking_max_age_days','ticker','live']);
  update public.site_settings set data = clean, updated_at = now(), updated_by = auth.uid() where id = 1;
  -- rebuild the website if instant updates are set up (ignored otherwise)
  begin
    if to_regprocedure('public.fire_rebuild()') is not null then execute 'select public.fire_rebuild()'; end if;
  exception when others then null;
  end;
end $$;

-- which keys are saved (never the secret values themselves)
create or replace function public.secret_status()
returns table (key text, is_set boolean, hint text) language plpgsql security definer stable set search_path = public as $$
begin
  if public.editor_role() is distinct from 'admin' then raise exception 'Only admins can see this'; end if;
  return query
    select k.key, coalesce(s.value, '') not in ('', 'PASTE_TOKEN_HERE'),
           case when coalesce(s.value, '') in ('', 'PASTE_TOKEN_HERE') then null
                when k.key = 'livekit_url' then s.value
                when k.key = 'livekit_api_key' then s.value
                else '...' || right(s.value, 4) end
    from (values ('livekit_url'), ('livekit_api_key'), ('livekit_api_secret'), ('github_token')) as k(key)
    left join public.app_secrets s on s.key = k.key;
end $$;

create or replace function public.secret_set(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.editor_role() is distinct from 'admin' then raise exception 'Only admins can change keys'; end if;
  if p_key not in ('livekit_url', 'livekit_api_key', 'livekit_api_secret', 'github_token') then raise exception 'Unknown setting'; end if;
  if nullif(trim(p_value), '') is null then delete from public.app_secrets where key = p_key;
  else insert into public.app_secrets (key, value) values (p_key, trim(p_value))
       on conflict (key) do update set value = excluded.value; end if;
end $$;

revoke execute on function public.settings_save(jsonb), public.secret_status(), public.secret_set(text, text) from public, anon;
grant execute on function public.settings_save(jsonb), public.secret_status(), public.secret_set(text, text) to authenticated;
