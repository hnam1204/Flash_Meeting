-- Require a real meeting-facing name for every new or rejoined participant.

alter table public.meeting_participants
  drop constraint if exists meeting_participants_display_name_check;

alter table public.meeting_participants
  add constraint meeting_participants_display_name_check
  check (char_length(btrim(display_name)) between 2 and 50)
  not valid;

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
    'endedAt', p_meeting.ended_at
  );
$$;

create or replace function public.flash_meeting_join_meeting(
  p_room_code text,
  p_display_name text,
  p_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_room_code text := upper(btrim(coalesce(p_room_code, '')));
  raw_display_name text := coalesce(p_display_name, '');
  normalized_display_name text := btrim(regexp_replace(raw_display_name, '[[:space:]]+', ' ', 'g'));
  normalized_session_id text := btrim(coalesce(p_session_id, ''));
  meeting_row public.meetings;
  participant_row public.meeting_participants;
  blocked_row public.meeting_participants;
  active_count integer;
  destination text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if normalized_room_code = '' then
    raise exception 'INVALID_ROOM_CODE' using errcode = '22023';
  end if;
  if raw_display_name ~ '[[:cntrl:]]'
    or char_length(normalized_display_name) < 2
    or char_length(normalized_display_name) > 50
    or lower(normalized_display_name) in ('anonymous', 'guest', 'gmail user', 'khách tham gia', 'member', 'một thành viên', 'participant', 'unknown', 'user') then
    raise exception 'INVALID_DISPLAY_NAME' using errcode = '22023';
  end if;
  if normalized_session_id !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'INVALID_SESSION_ID' using errcode = '22023';
  end if;

  -- Serializing on the meeting row makes the capacity check safe for concurrent joins.
  select * into meeting_row
  from public.meetings
  where room_code = normalized_room_code
  for update;

  if not found then
    raise exception 'MEETING_NOT_FOUND' using errcode = 'P0001';
  end if;
  if meeting_row.status in ('ending', 'ended') then
    raise exception 'MEETING_ENDED' using errcode = 'P0001';
  end if;
  if meeting_row.status = 'cancelled' then
    raise exception 'MEETING_CANCELLED' using errcode = 'P0001';
  end if;
  if meeting_row.status = 'locked' then
    raise exception 'MEETING_LOCKED' using errcode = 'P0001';
  end if;

  update public.meeting_participants
  set status = 'left',
      left_at = coalesce(left_at, now()),
      screen_share_active = false,
      updated_at = now()
  where meeting_id = meeting_row.id
    and status in ('joining', 'admitted')
    and last_seen_at < now() - interval '90 seconds';

  select * into blocked_row
  from public.meeting_participants
  where meeting_id = meeting_row.id
    and user_id = auth.uid()
    and status in ('blocked', 'removed')
  order by updated_at desc
  limit 1;

  if found then
    raise exception 'USER_BLOCKED' using errcode = '42501';
  end if;

  select * into participant_row
  from public.meeting_participants
  where meeting_id = meeting_row.id
    and user_id = auth.uid()
    and session_id = normalized_session_id
    and status in ('joining', 'waiting', 'admitted')
  order by updated_at desc
  limit 1
  for update;

  if meeting_row.host_id = auth.uid() then
    if participant_row.id is null then
      insert into public.meeting_participants (
        meeting_id, user_id, session_id, livekit_identity, display_name,
        role, status, joined_at, last_seen_at
      ) values (
        meeting_row.id, auth.uid(), normalized_session_id,
        auth.uid()::text || ':' || normalized_session_id,
        normalized_display_name, 'host', 'admitted', now(), now()
      ) returning * into participant_row;
    else
      update public.meeting_participants
      set display_name = normalized_display_name,
          role = 'host',
          status = 'admitted',
          left_at = null,
          joined_at = coalesce(joined_at, now()),
          last_seen_at = now(),
          updated_at = now()
      where id = participant_row.id
      returning * into participant_row;
    end if;
    destination := 'meeting';
  else
    if meeting_row.status <> 'active' then
      raise exception 'MEETING_NOT_STARTED' using errcode = 'P0001';
    end if;

    if participant_row.id is not null and participant_row.status = 'admitted' then
      update public.meeting_participants
      set display_name = normalized_display_name,
          last_seen_at = now(),
          updated_at = now()
      where id = participant_row.id
      returning * into participant_row;
      destination := 'meeting';
    elsif meeting_row.waiting_room_enabled then
      if participant_row.id is null then
        insert into public.meeting_participants (
          meeting_id, user_id, session_id, livekit_identity, display_name,
          role, status, last_seen_at
        ) values (
          meeting_row.id, auth.uid(), normalized_session_id,
          auth.uid()::text || ':' || normalized_session_id,
          normalized_display_name, 'member', 'waiting', now()
        ) returning * into participant_row;
      else
        update public.meeting_participants
        set display_name = normalized_display_name,
            role = 'member',
            status = 'waiting',
            left_at = null,
            screen_share_active = false,
            last_seen_at = now(),
            updated_at = now()
        where id = participant_row.id
        returning * into participant_row;
      end if;
      destination := 'waiting-room';
    else
      select count(*)::integer into active_count
      from public.meeting_participants
      where meeting_id = meeting_row.id
        and status in ('joining', 'admitted');

      if participant_row.id is null and active_count >= meeting_row.max_participants then
        raise exception 'ROOM_FULL' using errcode = 'P0001';
      end if;

      if participant_row.id is null then
        insert into public.meeting_participants (
          meeting_id, user_id, session_id, livekit_identity, display_name,
          role, status, joined_at, last_seen_at
        ) values (
          meeting_row.id, auth.uid(), normalized_session_id,
          auth.uid()::text || ':' || normalized_session_id,
          normalized_display_name, 'member', 'admitted', now(), now()
        ) returning * into participant_row;
      else
        update public.meeting_participants
        set display_name = normalized_display_name,
            role = 'member',
            status = 'admitted',
            left_at = null,
            joined_at = coalesce(joined_at, now()),
            last_seen_at = now(),
            updated_at = now()
        where id = participant_row.id
        returning * into participant_row;
      end if;
      destination := 'meeting';
    end if;
  end if;

  perform public.flash_meeting_refresh_participant_count(meeting_row.id);
  select * into meeting_row from public.meetings where id = meeting_row.id;

  return jsonb_build_object(
    'meeting', public.flash_meeting_meeting_payload(meeting_row),
    'participant', public.flash_meeting_participant_payload(participant_row),
    'destination', destination,
    'requiresWaitingRoom', destination = 'waiting-room'
  );
end;
$$;

create or replace function public.flash_meeting_moderate_participant(
  p_meeting_id uuid,
  p_participant_id uuid,
  p_action text,
  p_value boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  meeting_row public.meetings;
  viewer_role text;
  target_row public.meeting_participants;
  active_count integer;
  normalized_action text := lower(btrim(coalesce(p_action, '')));
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into meeting_row from public.meetings where id = p_meeting_id for update;
  if not found then raise exception 'MEETING_NOT_FOUND' using errcode = 'P0001'; end if;

  if meeting_row.host_id = auth.uid() then
    viewer_role := 'host';
  else
    select role into viewer_role
    from public.meeting_participants
    where meeting_id = p_meeting_id
      and user_id = auth.uid()
      and status = 'admitted'
    order by updated_at desc
    limit 1;
  end if;
  if viewer_role not in ('host', 'co-host') then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;

  select * into target_row
  from public.meeting_participants
  where id = p_participant_id and meeting_id = p_meeting_id
  for update;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND' using errcode = 'P0001'; end if;
  if target_row.role = 'host' or (viewer_role = 'co-host' and target_row.role <> 'member') then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;

  if normalized_action in ('approve', 'admit') then
    if target_row.status <> 'waiting' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
    if target_row.display_name ~ '[[:cntrl:]]'
      or char_length(btrim(regexp_replace(target_row.display_name, '[[:space:]]+', ' ', 'g'))) < 2
      or char_length(btrim(regexp_replace(target_row.display_name, '[[:space:]]+', ' ', 'g'))) > 50
      or lower(btrim(regexp_replace(target_row.display_name, '[[:space:]]+', ' ', 'g'))) in ('anonymous', 'guest', 'gmail user', 'khách tham gia', 'member', 'một thành viên', 'participant', 'unknown', 'user') then
      raise exception 'INVALID_DISPLAY_NAME' using errcode = '22023';
    end if;
    update public.meeting_participants
    set status = 'admitted', joined_at = now(), left_at = null, last_seen_at = now(), updated_at = now()
    where id = target_row.id
    returning * into target_row;
  elsif normalized_action in ('reject', 'deny') then
    update public.meeting_participants
    set status = 'rejected', left_at = coalesce(left_at, now()), screen_share_active = false, updated_at = now()
    where id = target_row.id
    returning * into target_row;
  elsif normalized_action in ('remove', 'kick') then
    update public.meeting_participants
    set status = 'removed', left_at = coalesce(left_at, now()), screen_share_active = false, updated_at = now()
    where id = target_row.id
    returning * into target_row;
  elsif normalized_action in ('mute', 'mute_participant') then
    update public.meeting_participants
    set microphone_enabled = false, updated_at = now()
    where id = target_row.id
    returning * into target_row;
  elsif normalized_action in ('stop_camera', 'stop_participant_camera') then
    update public.meeting_participants
    set camera_enabled = false, updated_at = now()
    where id = target_row.id
    returning * into target_row;
  elsif normalized_action in ('promote', 'promote_to_co_host') then
    if viewer_role <> 'host' or target_row.status <> 'admitted' then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
    update public.meeting_participants set role = 'co-host', updated_at = now() where id = target_row.id returning * into target_row;
  elsif normalized_action in ('demote', 'demote_co_host') then
    if viewer_role <> 'host' or target_row.status <> 'admitted' then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
    update public.meeting_participants set role = 'member', updated_at = now() where id = target_row.id returning * into target_row;
  elsif normalized_action in ('set_share_permission', 'set_participant_share_permission') then
    update public.meeting_participants
    set share_screen_allowed = coalesce(p_value, not share_screen_allowed), updated_at = now()
    where id = target_row.id
    returning * into target_row;
  else
    raise exception 'INVALID_ACTION' using errcode = '22023';
  end if;

  if normalized_action in ('approve', 'admit') then
    update public.meeting_participants
    set status = 'left', left_at = coalesce(left_at, now()), screen_share_active = false, updated_at = now()
    where meeting_id = p_meeting_id
      and status in ('joining', 'admitted')
      and last_seen_at < now() - interval '90 seconds';
    select count(*)::integer into active_count
    from public.meeting_participants
    where meeting_id = p_meeting_id and status = 'admitted';
    if active_count > meeting_row.max_participants then
      raise exception 'ROOM_FULL' using errcode = 'P0001';
    end if;
  end if;

  perform public.flash_meeting_refresh_participant_count(p_meeting_id);
  return public.flash_meeting_participant_payload(target_row);
end;
$$;
