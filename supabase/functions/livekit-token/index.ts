import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import { AccessToken } from 'npm:livekit-server-sdk@2.19.0';

const corsHeaders = {
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-origin': '*',
  'content-type': 'application/json'
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function normalizeRoomCode(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function normalizeSessionId(value: unknown) {
  return String(value || '').trim();
}

function normalizeDisplayName(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function isValidDisplayName(value: unknown) {
  const raw = String(value ?? '');
  const normalized = normalizeDisplayName(value);
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return false;
  if (Array.from(normalized).length < 2 || Array.from(normalized).length > 50) return false;
  return !new Set([
    'anonymous',
    'guest',
    'gmail user',
    'khách tham gia',
    'member',
    'một thành viên',
    'participant',
    'unknown',
    'user'
  ]).has(normalized.toLocaleLowerCase());
}

function resolveAccountDisplayName(user: any, profile?: any) {
  const metadata = user?.user_metadata || {};
  const candidates = [
    profile?.display_name,
    metadata.full_name,
    metadata.name,
    String(user?.email || '').split('@')[0]
  ];
  return candidates.map(normalizeDisplayName).find(isValidDisplayName) || '';
}

function parseRpcPayload(value: unknown) {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function mapRpcError(error: any) {
  const message = String(error?.message || '').toUpperCase();
  if (message.includes('AUTH_REQUIRED')) return { code: 'AUTH_REQUIRED', status: 401 };
  if (message.includes('PERMISSION_DENIED') || message.includes('USER_BLOCKED')) return { code: 'PERMISSION_DENIED', status: 403 };
  if (message.includes('MEETING_NOT_FOUND')) return { code: 'MEETING_NOT_FOUND', status: 404 };
  if (message.includes('MEETING_NOT_STARTED')) return { code: 'MEETING_NOT_STARTED', status: 409 };
  if (message.includes('MEETING_ENDED')) return { code: 'MEETING_ENDED', status: 409 };
  if (message.includes('MEETING_LOCKED')) return { code: 'MEETING_LOCKED', status: 409 };
  if (message.includes('ROOM_FULL')) return { code: 'ROOM_FULL', status: 409 };
  if (message.includes('INVALID_DISPLAY_NAME')) return { code: 'INVALID_DISPLAY_NAME', status: 400 };
  if (message.includes('WAITING_ROOM')) return { code: 'WAITING_ROOM_REQUIRED', status: 409 };
  return { code: 'LIVEKIT_TOKEN_FAILED', status: 500 };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ errorCode: 'METHOD_NOT_ALLOWED' }, 405);

  const authorization = request.headers.get('authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return json({ errorCode: 'AUTH_REQUIRED' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || '';
  const livekitUrl = Deno.env.get('LIVEKIT_URL') || '';
  const livekitApiKey = Deno.env.get('LIVEKIT_API_KEY') || '';
  const livekitApiSecret = Deno.env.get('LIVEKIT_API_SECRET') || '';
  if (!supabaseUrl || !supabaseKey) return json({ errorCode: 'SERVICE_UNAVAILABLE' }, 503);
  if (!livekitUrl || !livekitApiKey || !livekitApiSecret) return json({ errorCode: 'LIVEKIT_NOT_CONFIGURED' }, 503);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ errorCode: 'AUTH_REQUIRED' }, 401);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ errorCode: 'INVALID_REQUEST' }, 400);
  }

  const roomCode = normalizeRoomCode(body?.roomCode);
  const sessionId = normalizeSessionId(body?.sessionId);
  if (!/^[A-Z0-9]{1,40}(?:-[A-Z0-9]{1,40}){0,3}$/.test(roomCode)) {
    return json({ errorCode: 'INVALID_ROOM_CODE' }, 400);
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(sessionId)) {
    return json({ errorCode: 'INVALID_SESSION_ID' }, 400);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userData.user.id)
    .maybeSingle();

  const requestedDisplayName = normalizeDisplayName(body?.displayName);
  const { data: currentParticipantData, error: currentParticipantError } = await supabase.rpc('flash_meeting_get_my_participant', {
    p_room_code: roomCode,
    p_session_id: sessionId
  });
  if (currentParticipantError) {
    const mapped = mapRpcError(currentParticipantError);
    return json({ errorCode: mapped.code }, mapped.status);
  }

  const currentParticipantPayload = parseRpcPayload(currentParticipantData) as any;
  const currentParticipant = currentParticipantPayload?.participant;
  if (currentParticipant?.status === 'waiting') {
    return json({ errorCode: 'WAITING_ROOM_REQUIRED' }, 409);
  }

  let joinData: any = null;
  if (currentParticipant?.status === 'admitted' && currentParticipantPayload?.meeting?.status === 'active') {
    joinData = {
      ...currentParticipantPayload,
      destination: 'meeting'
    };
  } else {
    const displayName = requestedDisplayName || resolveAccountDisplayName(userData.user, profile);
    if (!isValidDisplayName(displayName)) return json({ errorCode: 'INVALID_DISPLAY_NAME' }, 400);
    const { data, error } = await supabase.rpc('flash_meeting_join_meeting', {
      p_room_code: roomCode,
      p_display_name: displayName,
      p_session_id: sessionId
    });
    if (error) {
      const mapped = mapRpcError(error);
      return json({ errorCode: mapped.code }, mapped.status);
    }
    joinData = parseRpcPayload(data);
  }

  const destination = String(joinData?.destination || '');
  const meeting = joinData?.meeting;
  const participant = joinData?.participant;
  if (destination !== 'meeting' || !meeting?.id || !participant?.id) {
    return json({ errorCode: 'WAITING_ROOM_REQUIRED' }, 409);
  }
  const participantDisplayName = normalizeDisplayName(participant.displayName || participant.display_name);
  if (!isValidDisplayName(participantDisplayName)) {
    return json({ errorCode: 'INVALID_DISPLAY_NAME' }, 400);
  }

  const roomName = `flash-meeting:${meeting.id}`;
  const metadata = JSON.stringify({
    meetingId: meeting.id,
    participantId: participant.id,
    userId: userData.user.id,
    sessionId,
    role: participant.role,
    shareScreenAllowed: participant.shareScreenAllowed !== false
  });
  const accessToken = new AccessToken(livekitApiKey, livekitApiSecret, {
    identity: participant.livekitIdentity,
    name: participantDisplayName,
    metadata,
    ttl: '10m'
  });
  accessToken.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  });

  return json({
    token: await accessToken.toJwt(),
    livekitUrl,
    roomName,
    meetingId: meeting.id,
    participantId: participant.id,
    livekitIdentity: participant.livekitIdentity,
    role: participant.role,
    displayName: participantDisplayName
  });
});
