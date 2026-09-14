-- FLASH MEETING
-- Fix Supabase Realtime RLS helper execution permission.

grant execute
on function public.flash_meeting_can_view_room(uuid)
to authenticated;