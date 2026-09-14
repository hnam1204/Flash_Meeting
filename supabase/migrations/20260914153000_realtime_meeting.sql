-- FLASH MEETING distributed room state, membership, chat, and LiveKit authorization.
-- This is a new migration so the already-applied analytics migration remains immutable.

create table if not exists public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  livekit_identity text not null,
  display_name text not null,
  role text not null default 'member',
  status text not null default 'joining',
  camera_enabled boolean not null default false,
  microphone_enabled boolean not null default false,
  share_screen_allowed boolean not null default true,
  screen_share_active boolean not null default false,
  hand_raised boolean not null default false,
  joined_at timestamptz,
  left_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_participants_session_check
    check (session_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  constraint meeting_participants_identity_check
    check (char_length(livekit_identity) between 16 and 220),
  constraint meeting_participants_display_name_check
    check (char_length(btrim(display_name)) between 1 and 50),
  constraint meeting_participants_display_name_trimmed_check
    check (display_name = btrim(display_name)),
  constraint meeting_participants_role_check
    check (role in ('host', 'co-host', 'member')),
  constraint meeting_participants_status_check
    check (status in ('joining', 'waiting', 'admitted', 'left', 'removed', 'blocked', 'rejected'))
);

create unique index if not exists meeting_participants_livekit_identity_uidx
  on public.meeting_participants (meeting_id, livekit_identity);

create unique index if not exists meeting_participants_active_session_uidx
  on public.meeting_participants (meeting_id, user_id, session_id)
  where status in ('joining', 'waiting', 'admitted');

create index if not exists meeting_participants_meeting_status_idx
  on public.meeting_participants (meeting_id, status, last_seen_at desc);

create index if not exists meeting_participants_user_meeting_idx
  on public.meeting_participants (user_id, meeting_id, updated_at desc);

create table if not exists public.meeting_messages (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  sender_display_name text not null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint meeting_messages_display_name_check
    check (char_length(btrim(sender_display_name)) between 1 and 50),
  constraint meeting_messages_content_check
    check (char_length(btrim(content)) between 1 and 2000),
  constraint meeting_messages_content_trimmed_check
    check (content = btrim(content))
);

create index if not exists meeting_messages_meeting_created_idx
  on public.meeting_messages (meeting_id, created_at desc);

create or replace function public.flash_meeting_participant_payload(
  p_participant public.meeting_participants
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p_participant.id,
    'meetingId', p_participant.meeting_id,
    'userId', p_participant.user_id,
    'sessionId', p_participant.session_id,
    'livekitIdentity', p_participant.livekit_identity,
    'displayName', p_participant.display_name,
    'role', p_participant.role,
    'status', p_participant.status,
    'cameraEnabled', p_participant.camera_enabled,
    'microphoneEnabled', p_participant.microphone_enabled,
    'shareScreenAllowed', p_participant.share_screen_allowed,
    'screenSharing', p_participant.screen_share_active,
    'handRaised', p_participant.hand_raised,
    'joinedAt', p_participant.joined_at,
    'lastSeenAt', p_participant.last_seen_at
  );
$$;

create or replace function public.flash_meeting_refresh_participant_count(p_meeting_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_count integer;
begin
  select count(*)::integer
  into next_count
  from public.meeting_participants
  where meeting_id = p_meeting_id
    and status = 'admitted';

  update public.meetings
  set participant_count = least(greatest(coalesce(next_count, 0), 0), max_participants)
  where id = p_meeting_id;

  return coalesce(next_count, 0);
end;
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
  normalized_display_name text := left(btrim(coalesce(p_display_name, '')), 50);
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
  if normalized_display_name = '' then
    normalized_display_name := 'Gmail user';
  end if;
  if char_length(normalized_display_name) < 1 then
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

create or replace function public.flash_meeting_get_my_participant(
  p_room_code text,
  p_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  meeting_row public.meetings;
  participant_row public.meeting_participants;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into meeting_row
  from public.meetings
  where room_code = upper(btrim(coalesce(p_room_code, '')));
  if not found then
    raise exception 'MEETING_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into participant_row
  from public.meeting_participants
  where meeting_id = meeting_row.id
    and user_id = auth.uid()
    and session_id = btrim(coalesce(p_session_id, ''))
  order by updated_at desc
  limit 1;

  return jsonb_build_object(
    'meeting', public.flash_meeting_meeting_payload(meeting_row),
    'participant', case when participant_row.id is null then null else public.flash_meeting_participant_payload(participant_row) end,
    'destination', case when participant_row.status = 'waiting' then 'waiting-room' when participant_row.status = 'admitted' then 'meeting' else null end
  );
end;
$$;

create or replace function public.flash_meeting_touch_participant(
  p_meeting_id uuid,
  p_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  participant_row public.meeting_participants;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  update public.meeting_participants
  set last_seen_at = now(),
      updated_at = now()
  where meeting_id = p_meeting_id
    and user_id = auth.uid()
    and session_id = btrim(coalesce(p_session_id, ''))
    and status in ('joining', 'waiting', 'admitted')
  returning * into participant_row;

  if not found then
    raise exception 'PARTICIPANT_NOT_FOUND' using errcode = 'P0001';
  end if;
  return public.flash_meeting_participant_payload(participant_row);
end;
$$;

create or replace function public.flash_meeting_set_media_state(
  p_meeting_id uuid,
  p_session_id text,
  p_camera_enabled boolean,
  p_microphone_enabled boolean,
  p_hand_raised boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  participant_row public.meeting_participants;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  update public.meeting_participants
  set camera_enabled = coalesce(p_camera_enabled, camera_enabled),
      microphone_enabled = coalesce(p_microphone_enabled, microphone_enabled),
      hand_raised = coalesce(p_hand_raised, hand_raised),
      last_seen_at = now(),
      updated_at = now()
  where meeting_id = p_meeting_id
    and user_id = auth.uid()
    and session_id = btrim(coalesce(p_session_id, ''))
    and status = 'admitted'
  returning * into participant_row;

  if not found then
    raise exception 'PARTICIPANT_NOT_FOUND' using errcode = 'P0001';
  end if;
  return public.flash_meeting_participant_payload(participant_row);
end;
$$;

create or replace function public.flash_meeting_set_screen_share_state(
  p_meeting_id uuid,
  p_session_id text,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  meeting_row public.meetings;
  participant_row public.meeting_participants;
  existing_presenter public.meeting_participants;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into meeting_row
  from public.meetings
  where id = p_meeting_id
  for update;
  if not found then
    raise exception 'MEETING_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into participant_row
  from public.meeting_participants
  where meeting_id = p_meeting_id
    and user_id = auth.uid()
    and session_id = btrim(coalesce(p_session_id, ''))
    and status = 'admitted'
  for update;
  if not found then
    raise exception 'PARTICIPANT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if coalesce(p_active, false) then
    if meeting_row.status <> 'active' then
      raise exception 'MEETING_NOT_ACTIVE' using errcode = 'P0001';
    end if;
    if not participant_row.share_screen_allowed then
      raise exception 'SCREEN_SHARE_NOT_ALLOWED' using errcode = '42501';
    end if;

    update public.meeting_participants
    set screen_share_active = false,
        updated_at = now()
    where meeting_id = p_meeting_id
      and screen_share_active = true
      and status <> 'admitted';

    select * into existing_presenter
    from public.meeting_participants
    where meeting_id = p_meeting_id
      and screen_share_active = true
      and status = 'admitted'
      and id <> participant_row.id
    order by updated_at desc
    limit 1
    for update;

    if found then
      raise exception 'SCREEN_SHARE_ACTIVE' using errcode = 'P0001', detail = existing_presenter.display_name;
    end if;
  end if;

  update public.meeting_participants
  set screen_share_active = coalesce(p_active, false),
      last_seen_at = now(),
      updated_at = now()
  where id = participant_row.id
  returning * into participant_row;

  return public.flash_meeting_participant_payload(participant_row);
end;
$$;

create or replace function public.flash_meeting_leave_meeting(
  p_meeting_id uuid,
  p_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  meeting_row public.meetings;
  participant_row public.meeting_participants;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into meeting_row
  from public.meetings
  where id = p_meeting_id
  for update;
  if not found then
    raise exception 'MEETING_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.meeting_participants
  set status = 'left',
      left_at = coalesce(left_at, now()),
      screen_share_active = false,
      last_seen_at = now(),
      updated_at = now()
  where meeting_id = p_meeting_id
    and user_id = auth.uid()
    and session_id = btrim(coalesce(p_session_id, ''))
    and status in ('joining', 'waiting', 'admitted')
  returning * into participant_row;

  if not found then
    return null;
  end if;
  perform public.flash_meeting_refresh_participant_count(p_meeting_id);
  return public.flash_meeting_participant_payload(participant_row);
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

create or replace function public.flash_meeting_get_participants(p_meeting_id uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(public.flash_meeting_participant_payload(p) order by p.joined_at nulls last, p.created_at), '[]'::jsonb)
  from public.meeting_participants p
  where p.meeting_id = p_meeting_id
    and p.status in ('joining', 'waiting', 'admitted')
    and (
      p.user_id = auth.uid()
      or exists (select 1 from public.meetings m where m.id = p_meeting_id and m.host_id = auth.uid())
      or exists (
        select 1 from public.meeting_participants viewer
        where viewer.meeting_id = p_meeting_id
          and viewer.user_id = auth.uid()
          and viewer.status = 'admitted'
      )
    );
$$;

create or replace function public.flash_meeting_can_view_chat(p_meeting_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.meetings m where m.id = p_meeting_id and m.host_id = auth.uid())
    or exists (
      select 1 from public.meeting_participants p
      where p.meeting_id = p_meeting_id
        and p.user_id = auth.uid()
        and p.status = 'admitted'
    )
  );
$$;

create or replace function public.flash_meeting_get_messages(p_meeting_id uuid, p_limit integer default 100)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'meetingId', m.meeting_id,
      'senderUserId', m.sender_user_id,
      'senderDisplayName', m.sender_display_name,
      'content', m.content,
      'createdAt', m.created_at
    ) order by m.created_at
  ), '[]'::jsonb)
  from (
    select * from public.meeting_messages
    where meeting_id = p_meeting_id
    order by created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 100)
  ) m
   where public.flash_meeting_can_view_chat(p_meeting_id);
$$;

-- Ending the meeting also invalidates every active membership so capacity is released.
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
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into meeting_row from public.meetings where room_code = normalized_room_code for update;
  if not found then raise exception 'MEETING_NOT_FOUND' using errcode = 'P0001'; end if;
  if meeting_row.host_id <> auth.uid() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if meeting_row.status = 'ended' then return public.flash_meeting_meeting_payload(meeting_row); end if;
  if meeting_row.status <> 'active' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  update public.meetings
  set status = 'ended', ended_at = coalesce(ended_at, now()), participant_count = 0
  where id = meeting_row.id
  returning * into meeting_row;

  update public.meeting_participants
  set status = 'left', left_at = coalesce(left_at, now()), screen_share_active = false, updated_at = now()
  where meeting_id = meeting_row.id and status in ('joining', 'waiting', 'admitted');

  return public.flash_meeting_meeting_payload(meeting_row);
end;
$$;

create or replace function public.flash_meeting_can_view_room(p_meeting_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.meetings m where m.id = p_meeting_id and m.host_id = auth.uid())
    or exists (
      select 1 from public.meeting_participants p
      where p.meeting_id = p_meeting_id
        and p.user_id = auth.uid()
        and p.status in ('joining', 'waiting', 'admitted')
    )
  );
$$;

alter table public.meeting_participants enable row level security;
alter table public.meeting_messages enable row level security;

revoke all on table public.meeting_participants from public, anon, authenticated;
revoke all on table public.meeting_messages from public, anon, authenticated;
grant select on table public.meetings to authenticated;
grant select on table public.meeting_participants to authenticated;
grant select, insert on table public.meeting_messages to authenticated;

drop policy if exists meetings_select_authorized on public.meetings;
create policy meetings_select_authorized
on public.meetings
for select
to authenticated
using (
  public.meetings.host_id = (select auth.uid())
  or exists (
    select 1
    from public.meeting_participants p
    where p.meeting_id = public.meetings.id
      and p.user_id = (select auth.uid())
      and p.status not in ('blocked', 'removed', 'rejected')
  )
);

drop policy if exists meeting_participants_select_authorized on public.meeting_participants;
create policy meeting_participants_select_authorized
on public.meeting_participants
for select
to authenticated
using (
  public.meeting_participants.user_id = (select auth.uid())
  or public.flash_meeting_can_view_room(public.meeting_participants.meeting_id)
);

drop policy if exists meeting_messages_select_authorized on public.meeting_messages;
create policy meeting_messages_select_authorized
on public.meeting_messages
for select
to authenticated
using (
  public.flash_meeting_can_view_room(public.meeting_messages.meeting_id)
);

drop policy if exists meeting_messages_insert_authorized on public.meeting_messages;
create policy meeting_messages_insert_authorized
on public.meeting_messages
for insert
to authenticated
with check (
  public.meeting_messages.sender_user_id = (select auth.uid())
  and exists (
    select 1
    from public.meetings m
    where m.id = public.meeting_messages.meeting_id
      and m.status = 'active'
  )
  and exists (
    select 1 from public.meeting_participants p
    where p.meeting_id = public.meeting_messages.meeting_id
      and p.user_id = (select auth.uid())
      and p.status = 'admitted'
  )
);

-- Realtime only exposes rows already allowed by the RLS policies above.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meeting_participants') then
      execute 'alter publication supabase_realtime add table public.meeting_participants';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meeting_messages') then
      execute 'alter publication supabase_realtime add table public.meeting_messages';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meetings') then
      execute 'alter publication supabase_realtime add table public.meetings';
    end if;
  end if;
end;
$$;

revoke all on function public.flash_meeting_participant_payload(public.meeting_participants) from public, anon, authenticated;
revoke all on function public.flash_meeting_refresh_participant_count(uuid) from public, anon, authenticated;
revoke all on function public.flash_meeting_join_meeting(text, text, text) from public, anon, authenticated;
revoke all on function public.flash_meeting_get_my_participant(text, text) from public, anon, authenticated;
revoke all on function public.flash_meeting_touch_participant(uuid, text) from public, anon, authenticated;
revoke all on function public.flash_meeting_set_media_state(uuid, text, boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function public.flash_meeting_set_screen_share_state(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.flash_meeting_leave_meeting(uuid, text) from public, anon, authenticated;
revoke all on function public.flash_meeting_moderate_participant(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.flash_meeting_get_participants(uuid) from public, anon, authenticated;
revoke all on function public.flash_meeting_get_messages(uuid, integer) from public, anon, authenticated;
revoke all on function public.flash_meeting_end_meeting(text) from public, anon, authenticated;
revoke all on function public.flash_meeting_can_view_room(uuid) from public, anon, authenticated;
revoke all on function public.flash_meeting_can_view_chat(uuid) from public, anon, authenticated;

grant execute on function public.flash_meeting_join_meeting(text, text, text) to authenticated;
grant execute on function public.flash_meeting_get_my_participant(text, text) to authenticated;
grant execute on function public.flash_meeting_touch_participant(uuid, text) to authenticated;
grant execute on function public.flash_meeting_set_media_state(uuid, text, boolean, boolean, boolean) to authenticated;
grant execute on function public.flash_meeting_set_screen_share_state(uuid, text, boolean) to authenticated;
grant execute on function public.flash_meeting_leave_meeting(uuid, text) to authenticated;
grant execute on function public.flash_meeting_moderate_participant(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.flash_meeting_get_participants(uuid) to authenticated;
grant execute on function public.flash_meeting_get_messages(uuid, integer) to authenticated;
grant execute on function public.flash_meeting_end_meeting(text) to authenticated;
grant execute on function public.flash_meeting_can_view_chat(uuid) to authenticated;
