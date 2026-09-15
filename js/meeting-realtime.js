import { configState } from './config.js';
import { authService } from './auth-service.js';
import { validateMeetingDisplayName } from './display-name.js';

const SESSION_STORAGE_KEY = 'flashMeeting.meetingSessionId';
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_MESSAGE_LENGTH = 2_000;

let supabasePromise;

async function getSupabase() {
  if (!configState.hasSupabase) return null;
  if (!supabasePromise) {
    supabasePromise = import('./supabase-client.js').then((module) => module.supabase);
  }
  return supabasePromise;
}

function randomSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, '');
  const values = new Uint32Array(4);
  globalThis.crypto?.getRandomValues?.(values);
  return `${Date.now().toString(36)}${Array.from(values, (value) => value.toString(36)).join('')}`.slice(0, 32);
}

export function getMeetingSessionId() {
  try {
    const stored = String(sessionStorage.getItem(SESSION_STORAGE_KEY) || '').trim();
    if (/^[A-Za-z0-9_-]{16,128}$/.test(stored)) return stored;
    const next = randomSessionId();
    sessionStorage.setItem(SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return randomSessionId();
  }
}

export function normalizeRealtimeParticipant(value) {
  if (!value || typeof value !== 'object') return null;
  const nameValidation = validateMeetingDisplayName(value.name || value.displayName || value.display_name);
  return {
    id: String(value.id || '').trim(),
    identity: String(value.identity || value.livekitIdentity || value.livekit_identity || '').trim(),
    participantId: String(value.participantId || value.id || '').trim(),
    meetingId: String(value.meetingId || value.meeting_id || '').trim(),
    userId: String(value.userId || value.user_id || '').trim(),
    sessionId: String(value.sessionId || value.session_id || '').trim(),
    livekitIdentity: String(value.livekitIdentity || value.livekit_identity || '').trim(),
    name: nameValidation.valid ? nameValidation.value : '',
    role: String(value.role || 'member').trim(),
    roleFromMetadata: Boolean(value.roleFromMetadata),
    status: String(value.status || 'admitted').trim(),
    isConnected: value.isConnected !== false,
    cameraPublication: value.cameraPublication || null,
    microphonePublication: value.microphonePublication || null,
    screenSharePublication: value.screenSharePublication || null,
    cameraTrack: value.cameraTrack || null,
    microphoneTrack: value.microphoneTrack || null,
    screenShareTrack: value.screenShareTrack || null,
    screenShareActive: Boolean(value.screenShareActive ?? value.screenSharing ?? value.screen_share_active),
    audioLevel: Number.isFinite(Number(value.audioLevel)) ? Number(value.audioLevel) : 0,
    cameraEnabled: Boolean(value.cameraEnabled ?? value.camera_enabled),
    microphoneEnabled: Boolean(value.microphoneEnabled ?? value.microphone_enabled),
    shareScreenAllowed: value.shareScreenAllowed ?? (value.share_screen_allowed !== false),
    screenSharing: Boolean(value.screenSharing ?? value.screenShareActive ?? value.screen_share_active),
    handRaised: Boolean(value.handRaised ?? value.hand_raised),
    joinedAt: value.joinedAt || value.joined_at || null,
    lastSeenAt: value.lastSeenAt || value.last_seen_at || null
  };
}

export function normalizeRealtimeMessage(value) {
  if (!value || typeof value !== 'object') return null;
  const content = String(value.content || '').trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!content) return null;
  const authorValidation = validateMeetingDisplayName(value.author || value.senderDisplayName || value.sender_display_name);
  if (!authorValidation.valid) return null;
  return {
    id: String(value.id || '').trim(),
    meetingId: String(value.meetingId || value.meeting_id || '').trim(),
    senderUserId: String(value.senderUserId || value.sender_user_id || '').trim(),
    author: authorValidation.value,
    content,
    createdAt: value.createdAt || value.created_at || null
  };
}

function parseRpcPayload(value) {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function errorCode(error, fallback = 'REALTIME_UNAVAILABLE') {
  const message = String(error?.message || '').toUpperCase();
  const known = [
    'AUTH_REQUIRED', 'MEETING_NOT_FOUND', 'MEETING_ENDED', 'MEETING_NOT_STARTED',
    'MEETING_LOCKED', 'ROOM_FULL', 'USER_BLOCKED', 'PERMISSION_DENIED',
    'PARTICIPANT_NOT_FOUND', 'WAITING_ROOM_REQUIRED', 'SCREEN_SHARE_ACTIVE',
    'SCREEN_SHARE_NOT_ALLOWED',
    'MEETING_NOT_ACTIVE', 'INVALID_STATE', 'INVALID_DISPLAY_NAME', 'RATE_LIMITED'
  ];
  return known.find((code) => message.includes(code)) || fallback;
}

function normalizeMeetingUpdate(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    id: value.id,
    roomCode: value.roomCode ?? value.room_code,
    title: value.title,
    hostId: value.hostId ?? value.host_id,
    status: value.status,
    maxParticipants: value.maxParticipants ?? value.max_participants,
    waitingRoomEnabled: value.waitingRoomEnabled ?? value.waiting_room_enabled,
    participantCount: value.participantCount ?? value.participant_count,
    createdAt: value.createdAt ?? value.created_at,
    startedAt: value.startedAt ?? value.started_at,
    endedAt: value.endedAt ?? value.ended_at,
    endedReason: value.endedReason ?? value.ended_reason,
    hasHadAttendee: value.hasHadAttendee === true || value.has_had_attendee === true
  };
}

export async function requestLiveKitToken(roomCode, sessionId = getMeetingSessionId(), displayName = '') {
  const supabase = await getSupabase();
  if (!supabase) return { success: false, code: 'CONFIGURATION_ERROR' };
  const { data, error } = await supabase.functions.invoke('livekit-token', {
    body: { roomCode, sessionId, displayName }
  });
  if (error) {
    let responseBody = error?.context?.body;
    if (typeof responseBody === 'string') {
      try { responseBody = JSON.parse(responseBody); } catch { responseBody = null; }
    }
    const responseCode = responseBody?.errorCode || errorCode(error, 'LIVEKIT_TOKEN_FAILED');
    return { success: false, code: responseCode };
  }
  if (!data?.token || !data?.livekitUrl || !data?.meetingId || !data?.participantId) {
    return { success: false, code: 'LIVEKIT_TOKEN_FAILED' };
  }
  return { success: true, ...data };
}

export function createMeetingRealtimeController({
  meetingId,
  roomCode = '',
  sessionId = getMeetingSessionId(),
  onParticipants,
  onParticipant,
  onMessage,
  onMeeting,
  onConnection,
  onError,
  displayName = ''
} = {}) {
  let supabase = null;
  let channel = null;
  let heartbeatTimer = 0;
  let closed = false;
  let hasSubscribed = false;
  let refreshMessagesInFlight = null;
  const messageIds = new Set();

  const reportError = (error, fallback) => {
    onError?.({ code: errorCode(error, fallback), error });
  };

  async function refreshRecentMessages() {
    if (!supabase || closed || refreshMessagesInFlight) return refreshMessagesInFlight;
    refreshMessagesInFlight = (async () => {
      const { data, error } = await supabase.rpc('flash_meeting_get_messages', {
        p_meeting_id: meetingId,
        p_limit: 100
      });
      if (error) {
        reportError(error, 'MESSAGES_REFRESH_FAILED');
        return;
      }
      (parseRpcPayload(data) || [])
        .map(normalizeRealtimeMessage)
        .filter((message) => message?.id && !messageIds.has(message.id))
        .forEach((message) => {
          messageIds.add(message.id);
          onMessage?.(message);
        });
    })().finally(() => {
      refreshMessagesInFlight = null;
    });
    return refreshMessagesInFlight;
  }

  async function connect() {
    if (!meetingId) {
      reportError(new Error('MEETING_NOT_FOUND'), 'MEETING_NOT_FOUND');
      return { success: false, code: 'MEETING_NOT_FOUND' };
    }
    supabase = await getSupabase();
    if (!supabase) {
      reportError(new Error('CONFIGURATION_ERROR'), 'CONFIGURATION_ERROR');
      return { success: false, code: 'CONFIGURATION_ERROR' };
    }

    const [participantsResult, messagesResult, meetingResult] = await Promise.all([
      supabase.rpc('flash_meeting_get_participants', { p_meeting_id: meetingId }),
      supabase.rpc('flash_meeting_get_messages', { p_meeting_id: meetingId, p_limit: 100 }),
      roomCode
        ? supabase.rpc('flash_meeting_get_meeting', { p_room_code: roomCode })
        : Promise.resolve({ data: null, error: null })
    ]);
    if (participantsResult.error) {
      reportError(participantsResult.error, 'PARTICIPANTS_LOAD_FAILED');
      return { success: false, code: errorCode(participantsResult.error, 'PARTICIPANTS_LOAD_FAILED') };
    }
    if (messagesResult.error) {
      reportError(messagesResult.error, 'MESSAGES_LOAD_FAILED');
      return { success: false, code: errorCode(messagesResult.error, 'MESSAGES_LOAD_FAILED') };
    }

    const participants = (parseRpcPayload(participantsResult.data) || [])
      .map(normalizeRealtimeParticipant)
      .filter((participant) => participant?.id);
    const messages = (parseRpcPayload(messagesResult.data) || [])
      .map(normalizeRealtimeMessage)
      .filter((message) => message?.id);
    messages.forEach((message) => messageIds.add(message.id));
    onParticipants?.(participants);
    messages.forEach((message) => onMessage?.(message));
    if (meetingResult.error) {
      reportError(meetingResult.error, 'MEETING_REFRESH_FAILED');
    } else {
      onMeeting?.(normalizeMeetingUpdate(parseRpcPayload(meetingResult.data)));
    }
    if (closed) return { success: false, code: 'CLOSED' };

    channel = supabase.channel(`flash-meeting:${meetingId}:${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_participants', filter: `meeting_id=eq.${meetingId}` }, (payload) => {
        if (closed) return;
        const next = payload.eventType === 'DELETE' ? payload.old : payload.new;
        const participant = normalizeRealtimeParticipant(next);
        if (participant?.id) onParticipant?.(participant, payload.eventType);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'meeting_messages', filter: `meeting_id=eq.${meetingId}` }, (payload) => {
        if (closed) return;
        const message = normalizeRealtimeMessage(payload.new);
        if (!message?.id || messageIds.has(message.id)) return;
        messageIds.add(message.id);
        onMessage?.(message);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'meetings', filter: `id=eq.${meetingId}` }, (payload) => {
        if (!closed) onMeeting?.(normalizeMeetingUpdate(payload.new));
      });

    let subscriptionStatus = '';
    await new Promise((resolve) => {
      channel.subscribe((status) => {
        subscriptionStatus = status;
        onConnection?.(status);
        if (status === 'SUBSCRIBED' && hasSubscribed) void refreshRecentMessages();
        if (status === 'SUBSCRIBED') hasSubscribed = true;
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') resolve();
      });
    });
    if (closed) return { success: false, code: 'CLOSED' };
    if (subscriptionStatus !== 'SUBSCRIBED') {
      reportError(new Error(subscriptionStatus || 'REALTIME_SUBSCRIPTION_FAILED'), 'REALTIME_SUBSCRIPTION_FAILED');
      return { success: false, code: 'REALTIME_SUBSCRIPTION_FAILED' };
    }
    heartbeatTimer = window.setInterval(() => {
      void touch().catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
    return { success: true };
  }

  async function touch() {
    if (!supabase || closed) return { success: false, code: 'CLOSED' };
    const { data, error } = await supabase.rpc('flash_meeting_touch_participant', {
      p_meeting_id: meetingId,
      p_session_id: sessionId
    });
    if (error) {
      reportError(error, 'HEARTBEAT_FAILED');
      return { success: false, code: errorCode(error, 'HEARTBEAT_FAILED') };
    }
    return { success: true, participant: normalizeRealtimeParticipant(data) };
  }

  async function sendMessage(content) {
    if (!supabase || closed) return { success: false, code: 'CLOSED' };
    const normalized = String(content || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!normalized) return { success: false, code: 'INVALID_MESSAGE' };
    const senderName = validateMeetingDisplayName(displayName);
    if (!senderName.valid) return { success: false, code: 'INVALID_DISPLAY_NAME' };
    const { data, error } = await supabase
      .from('meeting_messages')
      .insert({
        meeting_id: meetingId,
        sender_user_id: authService.getSession()?.id,
        sender_display_name: senderName.value,
        content: normalized
      })
      .select('id, meeting_id, sender_user_id, sender_display_name, content, created_at')
      .single();
    if (error) {
      reportError(error, 'MESSAGE_SEND_FAILED');
      return { success: false, code: errorCode(error, 'MESSAGE_SEND_FAILED') };
    }
    const message = normalizeRealtimeMessage(data);
    if (message?.id && !messageIds.has(message.id)) {
      messageIds.add(message.id);
      onMessage?.(message);
    }
    return { success: Boolean(message), message };
  }

  async function moderateParticipant(participantId, action, value = null) {
    if (!supabase || closed) return { success: false, code: 'CLOSED' };
    const { data, error } = await supabase.rpc('flash_meeting_moderate_participant', {
      p_meeting_id: meetingId,
      p_participant_id: participantId,
      p_action: action,
      p_value: value
    });
    if (error) {
      reportError(error, 'MODERATION_FAILED');
      return { success: false, code: errorCode(error, 'MODERATION_FAILED') };
    }
    return { success: true, participant: normalizeRealtimeParticipant(data) };
  }

  async function setMediaState({ cameraEnabled, microphoneEnabled, handRaised = null } = {}) {
    if (!supabase || closed) return { success: false, code: 'CLOSED' };
    const { data, error } = await supabase.rpc('flash_meeting_set_media_state', {
      p_meeting_id: meetingId,
      p_session_id: sessionId,
      p_camera_enabled: Boolean(cameraEnabled),
      p_microphone_enabled: Boolean(microphoneEnabled),
      p_hand_raised: handRaised
    });
    if (error) {
      reportError(error, 'MEDIA_STATE_FAILED');
      return { success: false, code: errorCode(error, 'MEDIA_STATE_FAILED') };
    }
    return { success: true, participant: normalizeRealtimeParticipant(data) };
  }

  async function setScreenShareState(active) {
    if (!supabase || closed) return { success: false, code: 'CLOSED' };
    const { data, error } = await supabase.rpc('flash_meeting_set_screen_share_state', {
      p_meeting_id: meetingId,
      p_session_id: sessionId,
      p_active: Boolean(active)
    });
    if (error) {
      reportError(error, 'SCREEN_SHARE_STATE_FAILED');
      return { success: false, code: errorCode(error, 'SCREEN_SHARE_STATE_FAILED') };
    }
    return { success: true, participant: normalizeRealtimeParticipant(data) };
  }

  async function leave() {
    if (!supabase || !meetingId) return { success: true };
    const { error } = await supabase.rpc('flash_meeting_leave_meeting', {
      p_meeting_id: meetingId,
      p_session_id: sessionId
    });
    if (error) {
      reportError(error, 'LEAVE_FAILED');
      return { success: false, code: errorCode(error, 'LEAVE_FAILED') };
    }
    return { success: true };
  }

  function close() {
    closed = true;
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = 0;
    if (channel && supabase) void supabase.removeChannel(channel);
    channel = null;
  }

  return Object.freeze({
    connect,
    close,
    leave,
    touch,
    sendMessage,
    moderateParticipant,
    setMediaState,
    setScreenShareState,
    get sessionId() { return sessionId; }
  });
}

export function subscribeMeetingParticipants({ meetingId, onChange, onError } = {}) {
  let channel = null;
  let closed = false;
  (async () => {
    try {
      const supabase = await getSupabase();
      if (!supabase || !meetingId || closed) return;
      channel = supabase.channel(`flash-meeting-waiting:${meetingId}:${getMeetingSessionId()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_participants', filter: `meeting_id=eq.${meetingId}` }, (payload) => {
          if (!closed) onChange?.(normalizeRealtimeParticipant(payload.eventType === 'DELETE' ? payload.old : payload.new), payload.eventType);
        });
      await new Promise((resolve) => channel.subscribe((status) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') resolve();
      }));
    } catch (error) {
      if (!closed) onError?.({ code: errorCode(error), error });
    }
  })();
  return () => {
    closed = true;
    if (channel) void getSupabase().then((supabase) => supabase?.removeChannel(channel));
    channel = null;
  };
}
