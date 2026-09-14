-- FLASH MEETING
-- Allow a participant session to rejoin after a previous membership was left.
-- LiveKit identity only needs to be unique among currently active memberships.

drop index if exists public.meeting_participants_livekit_identity_uidx;

create unique index meeting_participants_livekit_identity_uidx
on public.meeting_participants (meeting_id, livekit_identity)
where status in ('joining', 'waiting', 'admitted');