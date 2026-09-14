-- FLASH MEETING global analytics and minimum centralized meeting lifecycle.

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  title text not null,
  host_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'preparing',
  max_participants integer not null default 50,
  waiting_room_enabled boolean not null default false,
  participant_count integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  constraint meetings_status_check
    check (status in ('preparing', 'active', 'ending', 'scheduled', 'ended', 'cancelled', 'locked')),
  constraint meetings_title_length_check
    check (char_length(btrim(title)) between 1 and 100),
  constraint meetings_title_trimmed_check
    check (title = btrim(title)),
  constraint meetings_max_participants_check
    check (max_participants between 1 and 50),
  constraint meetings_participant_count_check
    check (participant_count between 0 and max_participants),
  constraint meetings_started_state_check
    check (status in ('preparing', 'scheduled') or started_at is not null),
  constraint meetings_ended_state_check
    check (status <> 'ended' or ended_at is not null)
);

create index if not exists meetings_host_status_idx
  on public.meetings (host_id, status, created_at desc);

create index if not exists meetings_started_at_idx
  on public.meetings (started_at);

create table if not exists public.analytics_summary (
  scope text primary key,
  total_visits bigint not null default 0,
  total_users bigint not null default 0,
  total_meetings bigint not null default 0,
  active_meetings bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint analytics_summary_scope_check check (scope = 'global'),
  constraint analytics_summary_visits_check check (total_visits >= 0),
  constraint analytics_summary_users_check check (total_users >= 0),
  constraint analytics_summary_meetings_check check (total_meetings >= 0),
  constraint analytics_summary_active_check check (active_meetings >= 0 and active_meetings <= total_meetings)
);

create table if not exists public.analytics_visits (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists analytics_visits_session_last_seen_idx
  on public.analytics_visits (session_id, last_seen_at desc);

create index if not exists analytics_visits_started_at_idx
  on public.analytics_visits (started_at);

insert into public.analytics_summary (scope, total_users, total_meetings, active_meetings)
select
  'global',
  (select count(*) from auth.users),
  (select count(*) from public.meetings where status in ('active', 'ended')),
  (select count(*) from public.meetings where status = 'active')
on conflict (scope) do update
set total_users = excluded.total_users,
    total_meetings = excluded.total_meetings,
    active_meetings = excluded.active_meetings,
    updated_at = now();

create or replace function public.flash_meeting_record_visit(p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_session_id text := btrim(coalesce(p_session_id, ''));
  recent_visit_id uuid;
  counted boolean := false;
begin
  if char_length(normalized_session_id) < 16 or char_length(normalized_session_id) > 128 then
    raise exception 'INVALID_SESSION_ID' using errcode = '22023';
  end if;

  -- Serialize one browser session so two tabs cannot count its first request twice.
  perform pg_advisory_xact_lock(hashtextextended(normalized_session_id, 0));

  select id
  into recent_visit_id
  from public.analytics_visits
  where session_id = normalized_session_id
    and last_seen_at >= now() - interval '30 minutes'
  order by last_seen_at desc
  limit 1;

  if recent_visit_id is null then
    insert into public.analytics_visits (session_id, user_id)
    values (normalized_session_id, auth.uid());

    update public.analytics_summary
    set total_visits = total_visits + 1,
        updated_at = now()
    where scope = 'global';
    counted := true;
  else
    update public.analytics_visits
    set last_seen_at = now(),
        user_id = coalesce(user_id, auth.uid())
    where id = recent_visit_id;
  end if;

  return jsonb_build_object('counted', counted, 'sessionId', normalized_session_id);
end;
$$;

create or replace function public.flash_meeting_handle_analytics_user_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.analytics_summary (scope, total_users)
  values ('global', 1)
  on conflict (scope) do update
  set total_users = public.analytics_summary.total_users + 1,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists flash_meeting_on_analytics_user_created on auth.users;
create trigger flash_meeting_on_analytics_user_created
after insert on auth.users
for each row
execute function public.flash_meeting_handle_analytics_user_created();

create or replace function public.flash_meeting_sync_meeting_analytics()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' and new.status = 'active' then
    update public.analytics_summary
    set total_meetings = total_meetings + 1,
        active_meetings = active_meetings + 1,
        updated_at = now()
    where scope = 'global';
  elsif tg_op = 'UPDATE' then
    if old.status <> 'active' and new.status = 'active' then
      update public.analytics_summary
      set total_meetings = total_meetings + 1,
          active_meetings = active_meetings + 1,
          updated_at = now()
      where scope = 'global';
    elsif old.status = 'active' and new.status <> 'active' then
      update public.analytics_summary
      set active_meetings = greatest(0, active_meetings - 1),
          updated_at = now()
      where scope = 'global';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists flash_meeting_sync_meeting_analytics on public.meetings;
create trigger flash_meeting_sync_meeting_analytics
after insert or update of status on public.meetings
for each row
execute function public.flash_meeting_sync_meeting_analytics();

create or replace function public.flash_meeting_reconcile_analytics_summary()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.analytics_summary (scope, total_users, total_meetings, active_meetings)
  select
    'global',
    (select count(*) from auth.users),
    (select count(*) from public.meetings where status in ('active', 'ended')),
    (select count(*) from public.meetings where status = 'active')
  on conflict (scope) do update
  set total_users = excluded.total_users,
      total_meetings = excluded.total_meetings,
      active_meetings = excluded.active_meetings,
      updated_at = now();
end;
$$;

create or replace function public.flash_meeting_get_global_analytics()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  summary_row public.analytics_summary;
  activity jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into summary_row
  from public.analytics_summary
  where scope = 'global';

  with buckets as (
    select generate_series(
      date_trunc('hour', now()) - interval '23 hours',
      date_trunc('hour', now()),
      interval '1 hour'
    ) as bucket_start
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'time', bucket_start,
        'visits', (select count(*) from public.analytics_visits v where v.started_at >= bucket_start and v.started_at < bucket_start + interval '1 hour'),
        'meetingsStarted', (select count(*) from public.meetings m where m.started_at >= bucket_start and m.started_at < bucket_start + interval '1 hour' and m.status in ('active', 'ended'))
      )
      order by bucket_start
    ),
    '[]'::jsonb
  )
  into activity
  from buckets;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'totalVisits', greatest(0, summary_row.total_visits),
      'totalUsers', greatest(0, summary_row.total_users),
      'totalMeetings', greatest(0, summary_row.total_meetings),
      'activeMeetings', least(greatest(0, summary_row.active_meetings), greatest(0, summary_row.total_meetings)),
      'updatedAt', summary_row.updated_at
    ),
    'activity24h', activity
  );
end;
$$;

create or replace function public.flash_meeting_generate_room_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate text;
begin
  loop
    candidate := upper(
      substr(md5(random()::text || clock_timestamp()::text), 1, 3)
      || '-' || substr(md5(random()::text || clock_timestamp()::text), 4, 3)
      || '-' || substr(md5(random()::text || clock_timestamp()::text), 7, 3)
    );
    if not exists (select 1 from public.meetings where room_code = candidate) then
      return candidate;
    end if;
  end loop;
end;
$$;

create or replace function public.flash_meeting_meeting_payload(p_meeting public.meetings)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p_meeting.id,
    'roomCode', p_meeting.room_code,
    'title', p_meeting.title,
    'hostId', p_meeting.host_id,
    'hostName', coalesce((select display_name from public.profiles where id = p_meeting.host_id), 'Gmail user'),
    'status', p_meeting.status,
    'maxParticipants', p_meeting.max_participants,
    'waitingRoomEnabled', p_meeting.waiting_room_enabled,
    'participantCount', p_meeting.participant_count,
    'createdAt', p_meeting.created_at,
    'startedAt', p_meeting.started_at,
    'endedAt', p_meeting.ended_at
  );
$$;

create or replace function public.flash_meeting_create_meeting(
  p_title text,
  p_max_participants integer default 50,
  p_waiting_room_enabled boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  meeting_row public.meetings;
  normalized_title text := btrim(coalesce(p_title, ''));
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if char_length(normalized_title) < 1 or char_length(normalized_title) > 100 then
    raise exception 'INVALID_TITLE' using errcode = '22023';
  end if;
  if p_max_participants is null or p_max_participants < 1 or p_max_participants > 50 then
    raise exception 'INVALID_PARTICIPANT_LIMIT' using errcode = '22023';
  end if;

  insert into public.meetings (room_code, title, host_id, max_participants, waiting_room_enabled)
  values (public.flash_meeting_generate_room_code(), normalized_title, auth.uid(), p_max_participants, coalesce(p_waiting_room_enabled, false))
  returning * into meeting_row;

  return public.flash_meeting_meeting_payload(meeting_row);
end;
$$;

create or replace function public.flash_meeting_get_meeting(p_room_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  meeting_row public.meetings;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into meeting_row
  from public.meetings
  where room_code = upper(btrim(coalesce(p_room_code, '')));

  if not found then return null; end if;
  return public.flash_meeting_meeting_payload(meeting_row);
end;
$$;

create or replace function public.flash_meeting_list_my_meetings(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
      public.flash_meeting_meeting_payload(meetings_for_user.meeting_row)
      order by meetings_for_user.created_at desc
    )
    from (
      select m as meeting_row, m.created_at
      from public.meetings m
      where m.host_id = auth.uid()
      order by m.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) meetings_for_user
  ), '[]'::jsonb);
end;
$$;

create or replace function public.flash_meeting_start_meeting(p_room_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  meeting_row public.meetings;
  normalized_room_code text := upper(btrim(coalesce(p_room_code, '')));
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into meeting_row from public.meetings where room_code = normalized_room_code;
  if not found then raise exception 'MEETING_NOT_FOUND' using errcode = 'P0001'; end if;
  if meeting_row.host_id <> auth.uid() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if meeting_row.status = 'active' then return public.flash_meeting_meeting_payload(meeting_row); end if;
  if meeting_row.status not in ('preparing', 'scheduled') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  update public.meetings
  set status = 'active',
      started_at = coalesce(started_at, now()),
      ended_at = null
  where id = meeting_row.id
    and status in ('preparing', 'scheduled')
  returning * into meeting_row;

  if not found then
    select * into meeting_row from public.meetings where room_code = normalized_room_code;
  end if;
  return public.flash_meeting_meeting_payload(meeting_row);
end;
$$;

create or replace function public.flash_meeting_end_meeting(p_room_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  meeting_row public.meetings;
  normalized_room_code text := upper(btrim(coalesce(p_room_code, '')));
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into meeting_row from public.meetings where room_code = normalized_room_code;
  if not found then raise exception 'MEETING_NOT_FOUND' using errcode = 'P0001'; end if;
  if meeting_row.host_id <> auth.uid() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if meeting_row.status = 'ended' then return public.flash_meeting_meeting_payload(meeting_row); end if;
  if meeting_row.status <> 'active' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  update public.meetings
  set status = 'ended',
      ended_at = coalesce(ended_at, now())
  where id = meeting_row.id
    and status = 'active'
  returning * into meeting_row;

  if not found then
    select * into meeting_row from public.meetings where room_code = normalized_room_code;
  end if;
  return public.flash_meeting_meeting_payload(meeting_row);
end;
$$;

alter table public.meetings enable row level security;
alter table public.analytics_summary enable row level security;
alter table public.analytics_visits enable row level security;

revoke all on table public.meetings from public, anon, authenticated;
revoke all on table public.analytics_visits from public, anon, authenticated;
revoke all on table public.analytics_summary from public, anon;
grant select on table public.analytics_summary to authenticated;

drop policy if exists analytics_summary_global_select on public.analytics_summary;
create policy analytics_summary_global_select
on public.analytics_summary
for select
to authenticated
using (scope = 'global');

revoke all on function public.flash_meeting_record_visit(text) from public, anon, authenticated;
revoke all on function public.flash_meeting_handle_analytics_user_created() from public, anon, authenticated;
revoke all on function public.flash_meeting_sync_meeting_analytics() from public, anon, authenticated;
revoke all on function public.flash_meeting_reconcile_analytics_summary() from public, anon, authenticated;
revoke all on function public.flash_meeting_get_global_analytics() from public, anon, authenticated;
revoke all on function public.flash_meeting_generate_room_code() from public, anon, authenticated;
revoke all on function public.flash_meeting_meeting_payload(public.meetings) from public, anon, authenticated;
revoke all on function public.flash_meeting_create_meeting(text, integer, boolean) from public, anon, authenticated;
revoke all on function public.flash_meeting_get_meeting(text) from public, anon, authenticated;
revoke all on function public.flash_meeting_list_my_meetings(integer) from public, anon, authenticated;
revoke all on function public.flash_meeting_start_meeting(text) from public, anon, authenticated;
revoke all on function public.flash_meeting_end_meeting(text) from public, anon, authenticated;
grant execute on function public.flash_meeting_reconcile_analytics_summary() to service_role;
grant execute on function public.flash_meeting_record_visit(text) to anon, authenticated;
grant execute on function public.flash_meeting_get_global_analytics() to authenticated;
grant execute on function public.flash_meeting_create_meeting(text, integer, boolean) to authenticated;
grant execute on function public.flash_meeting_get_meeting(text) to authenticated;
grant execute on function public.flash_meeting_list_my_meetings(integer) to authenticated;
grant execute on function public.flash_meeting_start_meeting(text) to authenticated;
grant execute on function public.flash_meeting_end_meeting(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'analytics_summary'
    ) then
    execute 'alter publication supabase_realtime add table public.analytics_summary';
  end if;
end;
$$;
