-- FLASH MEETING server-authoritative meeting expiry and creation throttling.
-- This migration is additive; historical migrations remain unchanged.

alter table public.meetings
  add column if not exists ended_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meetings'::regclass
      and conname = 'meetings_ended_reason_check'
  ) then
    alter table public.meetings
      add constraint meetings_ended_reason_check
      check (ended_reason is null or ended_reason in (
        'host_ended',
        'idle_no_attendee',
        'abandoned_preparing'
      ));
  end if;
end;
$$;

-- Existing indexes cover status-filtered lists and participant heartbeats. These
-- narrower indexes support the two server-side predicates added here.
create index if not exists meetings_host_created_at_idx
  on public.meetings (host_id, created_at desc);

create index if not exists meeting_participants_attendee_history_idx
  on public.meeting_participants (meeting_id, joined_at)
  where role <> 'host' and joined_at is not null;

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
    'hostName', coalesce((
      select display_name
      from public.profiles
      where id = p_meeting.host_id
        and lower(display_name) not in ('anonymous', 'guest', 'gmail user', 'khách tham gia', 'member', 'một thành viên', 'participant', 'unknown', 'user')
    ), ''),
    'status', p_meeting.status,
    'maxParticipants', p_meeting.max_participants,
    'waitingRoomEnabled', p_meeting.waiting_room_enabled,
    'participantCount', p_meeting.participant_count,
    'createdAt', p_meeting.created_at,
    'startedAt', p_meeting.started_at,
    'endedAt', p_meeting.ended_at,
    'endedReason', p_meeting.ended_reason,
    'hasHadAttendee', exists (
      select 1
      from public.meeting_participants p
      where p.meeting_id = p_meeting.id
        and p.role <> 'host'
        and p.joined_at is not null
    )
  );
$$;

-- The lock serializes creation attempts for one authenticated user, so
-- concurrent requests cannot both pass the five-in-ten-minutes check.
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
  actor_id uuid;
  recent_meeting_count integer;
  meeting_row public.meetings;
  normalized_title text := btrim(coalesce(p_title, ''));
begin
  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if char_length(normalized_title) < 1 or char_length(normalized_title) > 100 then
    raise exception 'INVALID_TITLE' using errcode = '22023';
  end if;
  if p_max_participants is null or p_max_participants < 1 or p_max_participants > 50 then
    raise exception 'INVALID_PARTICIPANT_LIMIT' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  select count(*)::integer
  into recent_meeting_count
  from public.meetings
  where host_id = actor_id
    and created_at >= now() - interval '10 minutes';

  if recent_meeting_count >= 5 then
    raise exception 'RATE_LIMITED'
      using errcode = 'P0001',
            detail = 'Maximum 5 meetings per authenticated user in 10 minutes';
  end if;

  insert into public.meetings (
    room_code,
    title,
    host_id,
    max_participants,
    waiting_room_enabled
  )
  values (
    public.flash_meeting_generate_room_code(),
    normalized_title,
    actor_id,
    p_max_participants,
    coalesce(p_waiting_room_enabled, false)
  )
  returning * into meeting_row;

  return public.flash_meeting_meeting_payload(meeting_row);
end;
$$;

-- Starting also locks the row so an old PREPARING meeting cannot be started
-- concurrently with the abandoned-room cancellation pass.
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

  select *
  into meeting_row
  from public.meetings
  where room_code = normalized_room_code
  for update;
  if not found then
    raise exception 'MEETING_NOT_FOUND' using errcode = 'P0001';
  end if;
  if meeting_row.host_id <> auth.uid() then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if meeting_row.status = 'active' then
    return public.flash_meeting_meeting_payload(meeting_row);
  end if;
  if meeting_row.status not in ('preparing', 'scheduled') then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;

  update public.meetings
  set status = 'active',
      started_at = coalesce(started_at, now()),
      ended_at = null,
      ended_reason = null
  where id = meeting_row.id
  returning * into meeting_row;

  return public.flash_meeting_meeting_payload(meeting_row);
end;
$$;

-- Manual host termination and scheduled idle termination share the same
-- ending state, but retain different reasons for history and analytics UI.
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

  select *
  into meeting_row
  from public.meetings
  where room_code = normalized_room_code
  for update;
  if not found then
    raise exception 'MEETING_NOT_FOUND' using errcode = 'P0001';
  end if;
  if meeting_row.host_id <> auth.uid() then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if meeting_row.status = 'ended' then
    return public.flash_meeting_meeting_payload(meeting_row);
  end if;
  if meeting_row.status <> 'active' then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;

  update public.meetings
  set status = 'ending',
      ended_reason = 'host_ended'
  where id = meeting_row.id
    and status = 'active';

  update public.meeting_participants
  set status = 'left',
      left_at = coalesce(left_at, now()),
      screen_share_active = false,
      camera_enabled = false,
      microphone_enabled = false,
      hand_raised = false,
      updated_at = now()
  where meeting_id = meeting_row.id
    and status in ('joining', 'waiting', 'admitted');

  update public.meetings
  set status = 'ended',
      ended_at = coalesce(ended_at, now()),
      participant_count = 0,
      ended_reason = 'host_ended'
  where id = meeting_row.id
    and status = 'ending'
  returning * into meeting_row;

  return public.flash_meeting_meeting_payload(meeting_row);
end;
$$;

-- This function is idempotent: each pass only claims ACTIVE/PREPARING rows,
-- locks one row at a time, and rechecks attendee history after the lock.
create or replace function public.flash_meeting_cleanup_idle_meetings()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate public.meetings;
  finalized public.meetings;
  has_had_attendee boolean;
  active_ended_count integer := 0;
  preparing_cancelled_count integer := 0;
  cutoff timestamptz := now() - interval '30 minutes';
begin
  for candidate in
    select *
    from public.meetings
    where (
      status = 'active'
      and started_at is not null
      and started_at <= cutoff
    )
    or (
      status = 'preparing'
      and started_at is null
      and created_at <= cutoff
    )
    order by created_at
    for update skip locked
  loop
    if candidate.status = 'active' then
      -- A joined-then-left member still exempts the meeting permanently.
      select exists (
        select 1
        from public.meeting_participants p
        where p.meeting_id = candidate.id
          and p.role <> 'host'
          and p.joined_at is not null
      )
      into has_had_attendee;

      if has_had_attendee then
        continue;
      end if;

      update public.meetings
      set status = 'ending',
          ended_reason = 'idle_no_attendee'
      where id = candidate.id
        and status = 'active'
      returning * into finalized;

      if not found then
        continue;
      end if;

      update public.meeting_participants
      set status = 'left',
          left_at = coalesce(left_at, now()),
          screen_share_active = false,
          camera_enabled = false,
          microphone_enabled = false,
          hand_raised = false,
          updated_at = now()
      where meeting_id = finalized.id
        and status in ('joining', 'waiting', 'admitted');

      update public.meetings
      set status = 'ended',
          ended_at = coalesce(ended_at, now()),
          participant_count = 0,
          ended_reason = 'idle_no_attendee'
      where id = finalized.id
        and status = 'ending'
      returning * into finalized;

      if found then
        active_ended_count := active_ended_count + 1;
      end if;
    elsif candidate.status = 'preparing' then
      update public.meetings
      set status = 'cancelled',
          ended_reason = 'abandoned_preparing'
      where id = candidate.id
        and status = 'preparing'
        and started_at is null
      returning * into finalized;

      if found then
        preparing_cancelled_count := preparing_cancelled_count + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'endedActive', active_ended_count,
    'cancelledPreparing', preparing_cancelled_count
  );
end;
$$;

revoke all on function public.flash_meeting_meeting_payload(public.meetings) from public, anon, authenticated;
revoke all on function public.flash_meeting_create_meeting(text, integer, boolean) from public, anon, authenticated;
revoke all on function public.flash_meeting_start_meeting(text) from public, anon, authenticated;
revoke all on function public.flash_meeting_end_meeting(text) from public, anon, authenticated;
revoke all on function public.flash_meeting_cleanup_idle_meetings() from public, anon, authenticated;

grant execute on function public.flash_meeting_meeting_payload(public.meetings) to authenticated;
grant execute on function public.flash_meeting_create_meeting(text, integer, boolean) to authenticated;
grant execute on function public.flash_meeting_start_meeting(text) to authenticated;
grant execute on function public.flash_meeting_end_meeting(text) to authenticated;
grant execute on function public.flash_meeting_cleanup_idle_meetings() to service_role;

-- Hosted Supabase projects commonly provide pg_cron. Keep the migration
-- usable where it is unavailable, while registering one global minute job
-- whenever the extension can be enabled.
do $$
declare
  existing_job_id bigint;
begin
  if exists (
    select 1
    from pg_available_extensions
    where name = 'pg_cron'
  ) then
    execute 'create extension if not exists pg_cron';

    if to_regclass('cron.job') is not null then
      select jobid
      into existing_job_id
      from cron.job
      where jobname = 'flash_meeting_idle_cleanup'
      limit 1;

      if existing_job_id is not null then
        perform cron.unschedule(existing_job_id);
      end if;

      perform cron.schedule(
        'flash_meeting_idle_cleanup',
        '* * * * *',
        'select public.flash_meeting_cleanup_idle_meetings();'
      );
    end if;
  end if;
exception
  when insufficient_privilege or feature_not_supported or undefined_file then
    raise notice 'pg_cron is available but could not be enabled; run the cleanup RPC from a trusted scheduler.';
end;
$$;
