-- FLASH MEETING Account Phase 1: profiles, RLS, and auth user provisioning.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length
    check (char_length(btrim(display_name)) between 2 and 50),
  constraint profiles_display_name_trimmed
    check (display_name = btrim(display_name))
);

create or replace function public.flash_meeting_profiles_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists flash_meeting_profiles_set_updated_at on public.profiles;
create trigger flash_meeting_profiles_set_updated_at
before update on public.profiles
for each row
execute function public.flash_meeting_profiles_set_updated_at();

create or replace function public.flash_meeting_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  profile_display_name text;
begin
  profile_display_name := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');

  if profile_display_name is null or char_length(profile_display_name) < 2 then
    profile_display_name := nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), '');
  end if;

  profile_display_name := left(coalesce(profile_display_name, 'User'), 50);
  if char_length(profile_display_name) < 2 then
    profile_display_name := 'User';
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, profile_display_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists flash_meeting_on_auth_user_created on auth.users;
create trigger flash_meeting_on_auth_user_created
after insert on auth.users
for each row
execute function public.flash_meeting_handle_new_user();

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

revoke all on table public.profiles from anon;
grant select, update on table public.profiles to authenticated;
