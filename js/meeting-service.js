import { getSession } from './auth-service.js';
import { configState } from './config.js';
import { isLikelyRoomCode, normalizeRoomCode } from './utils.js';
import { getMeetingSessionId, subscribeMeetingParticipants } from './meeting-realtime.js';
import { normalizeMeetingDisplayName, validateMeetingDisplayName } from './display-name.js';

export const MAX_MEETING_PARTICIPANTS = 50;
export const MEETING_IDLE_WARNING_MS = 25 * 60 * 1000;
export const MEETING_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const WAITING_ROOM_DEFAULT_ENABLED = false;
export const MEETING_TITLE_MAX_LENGTH = 100;
export const SUPPORTED_ACCESS_MODE = 'link';
export const MEETING_STATUSES = Object.freeze({
  PREPARING: 'preparing',
  ACTIVE: 'active',
  ENDING: 'ending',
  SCHEDULED: 'scheduled',
  ENDED: 'ended',
  CANCELLED: 'cancelled',
  LOCKED: 'locked'
});
export const PARTICIPANT_ROLES = Object.freeze({
  HOST: 'host',
  CO_HOST: 'co-host',
  MEMBER: 'member'
});

export const CREATE_MEETING_ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_DISPLAY_NAME: 'INVALID_DISPLAY_NAME',
  INVALID_TITLE: 'INVALID_TITLE',
  RATE_LIMITED: 'RATE_LIMITED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  CREATE_MEETING_FAILED: 'CREATE_MEETING_FAILED'
});

export const START_MEETING_ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_DISPLAY_NAME: 'INVALID_DISPLAY_NAME',
  INVALID_ROOM_CODE: 'INVALID_ROOM_CODE',
  MEETING_NOT_FOUND: 'MEETING_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_STATE: 'INVALID_STATE',
  NETWORK_ERROR: 'NETWORK_ERROR',
  START_MEETING_FAILED: 'START_MEETING_FAILED'
});

export const END_MEETING_ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_ROOM_CODE: 'INVALID_ROOM_CODE',
  MEETING_NOT_FOUND: 'MEETING_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_STATE: 'INVALID_STATE',
  NETWORK_ERROR: 'NETWORK_ERROR',
  END_MEETING_FAILED: 'END_MEETING_FAILED'
});

export const JOIN_MEETING_ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_DISPLAY_NAME: 'INVALID_DISPLAY_NAME',
  INVALID_ROOM_CODE: 'INVALID_ROOM_CODE',
  MEETING_NOT_FOUND: 'MEETING_NOT_FOUND',
  MEETING_ENDED: 'MEETING_ENDED',
  MEETING_CANCELLED: 'MEETING_CANCELLED',
  MEETING_LOCKED: 'MEETING_LOCKED',
  MEETING_NOT_STARTED: 'MEETING_NOT_STARTED',
  ROOM_FULL: 'ROOM_FULL',
  USER_BLOCKED: 'USER_BLOCKED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  JOIN_FAILED: 'JOIN_FAILED'
});

export const ADMISSION_DESTINATIONS = Object.freeze({
  MEETING: 'meeting',
  WAITING_ROOM: 'waiting-room',
  ROOM_FULL: 'room-full',
  ENDED: 'ended',
  BLOCKED: 'blocked',
  NOT_FOUND: 'not-found'
});

const DEFAULT_HISTORY_LIMIT = 5;
const MEETING_SYNC_CHANNEL = 'flash-meeting';
const MEETING_SYNC_STORAGE_KEY = 'flashMeeting.syncEvent';
const WAITING_REQUEST_STATUSES = Object.freeze({
  WAITING: 'waiting',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ROOM_FULL: 'room_full',
  MEETING_ENDED: 'meeting_ended',
  MEETING_LOCKED: 'meeting_locked',
  REMOVED: 'removed'
});

let supabasePromise;

async function getSupabaseClient() {
  if (!configState.hasSupabase) return null;
  if (!supabasePromise) {
    supabasePromise = import('./supabase-client.js')
      .then((module) => module.supabase)
      .catch(() => null);
  }
  return supabasePromise;
}

function isRemoteBackendMissing(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return ['PGRST202', 'PGRST205', '42P01', '42883'].includes(code)
    || message.includes('could not find the function')
    || message.includes('does not exist');
}

function isRemoteNetworkError(error) {
  const status = Number(error?.status);
  return status === 0 || status === 408 || status >= 500
    || ['AbortError', 'FetchError', 'NetworkError', 'TypeError'].includes(error?.name);
}

function mapMeetingRpcError(error, fallbackCode) {
  const message = String(error?.message || '').toUpperCase();
  if (message.includes('AUTH_REQUIRED') || String(error?.code || '') === '42501') return 'AUTH_REQUIRED';
  if (message.includes('INVALID_DISPLAY_NAME')) return 'INVALID_DISPLAY_NAME';
  if (message.includes('RATE_LIMITED')) return 'RATE_LIMITED';
  if (message.includes('MEETING_NOT_FOUND')) return 'MEETING_NOT_FOUND';
  if (message.includes('MEETING_ENDED')) return 'MEETING_ENDED';
  if (message.includes('MEETING_CANCELLED')) return 'MEETING_CANCELLED';
  if (message.includes('MEETING_LOCKED')) return 'MEETING_LOCKED';
  if (message.includes('MEETING_NOT_STARTED')) return 'MEETING_NOT_STARTED';
  if (message.includes('ROOM_FULL')) return 'ROOM_FULL';
  if (message.includes('USER_BLOCKED')) return 'USER_BLOCKED';
  if (message.includes('WAITING_ROOM')) return 'WAITING_ROOM_REQUIRED';
  if (message.includes('PERMISSION_DENIED')) return 'PERMISSION_DENIED';
  if (message.includes('INVALID_STATE')) return 'INVALID_STATE';
  if (isRemoteNetworkError(error)) return 'NETWORK_ERROR';
  return fallbackCode;
}

async function callRemoteRpc(name, params = {}) {
  const supabase = await getSupabaseClient();
  if (!supabase) return { available: false, data: null, error: null };
  try {
    const { data, error } = await supabase.rpc(name, params);
    return { available: true, data, error };
  } catch (error) {
    return { available: true, data: null, error };
  }
}

function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeMeetingStatus(value, meeting = {}) {
  const status = String(value || '').trim().toLowerCase();
  if (Object.values(MEETING_STATUSES).includes(status)) return status;
  if (toTimestamp(meeting.endedAt ?? meeting.ended_at)) return MEETING_STATUSES.ENDED;
  if (toTimestamp(meeting.startedAt ?? meeting.started_at)) return MEETING_STATUSES.ACTIVE;
  return MEETING_STATUSES.PREPARING;
}

export function normalizeMeeting(meeting) {
  if (!meeting || typeof meeting !== 'object') return null;
  const rawParticipantCount = meeting.participantCount ?? meeting.participant_count;
  const numericParticipantCount = Number(rawParticipantCount);
  const participantCount = rawParticipantCount !== null
    && rawParticipantCount !== undefined
    && rawParticipantCount !== ''
    && Number.isFinite(numericParticipantCount)
    ? Math.max(0, Math.min(MAX_MEETING_PARTICIPANTS, numericParticipantCount))
    : null;

  const normalized = {
    ...meeting,
    roomCode: normalizeRoomCode(meeting.roomCode ?? meeting.room_code),
    status: normalizeMeetingStatus(meeting.status, meeting),
    maxParticipants: Number(meeting.maxParticipants ?? meeting.max_participants ?? MAX_MEETING_PARTICIPANTS),
    participantCount,
    createdAt: toTimestamp(meeting.createdAt ?? meeting.created_at),
    startedAt: toTimestamp(meeting.startedAt ?? meeting.started_at),
    endedAt: toTimestamp(meeting.endedAt ?? meeting.ended_at),
    endedReason: String(meeting.endedReason ?? meeting.ended_reason ?? '').trim() || null,
    hasHadAttendee: meeting.hasHadAttendee === true || meeting.has_had_attendee === true
  };

  if (!normalized.maxParticipants || normalized.maxParticipants < 1) normalized.maxParticipants = MAX_MEETING_PARTICIPANTS;
  if (!normalized.createdAt) normalized.createdAt = normalized.startedAt || normalized.endedAt || null;
  if (normalized.status === MEETING_STATUSES.ACTIVE && !normalized.startedAt) normalized.status = MEETING_STATUSES.PREPARING;
  if ([MEETING_STATUSES.PREPARING, MEETING_STATUSES.SCHEDULED].includes(normalized.status)) {
    normalized.startedAt = null;
    normalized.endedAt = null;
  }
  if (normalized.status !== MEETING_STATUSES.ENDED) normalized.endedAt = null;
  return normalized;
}

function publishMeetingEvent(type, meeting) {
  const payload = {
    type,
    meetingId: String(meeting?.id || ''),
    roomCode: normalizeRoomCode(meeting?.roomCode),
    endedReason: meeting?.endedReason || null,
    timestamp: Date.now()
  };

  if (typeof BroadcastChannel === 'function') {
    try {
      const channel = new BroadcastChannel(MEETING_SYNC_CHANNEL);
      channel.postMessage(payload);
      channel.close();
    } catch {
      // Storage fallback below still supports same-browser tab sync.
    }
  }

  try {
    window.localStorage?.setItem(MEETING_SYNC_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Cross-tab sync is best effort when storage is unavailable.
  }
}

export function subscribeMeetingEvents(listener) {
  if (typeof listener !== 'function' || typeof window === 'undefined') return () => {};

  let channel = null;
  const handleMessage = (event) => listener(event.data || event);
  const handleStorage = (event) => {
    if (event.key !== MEETING_SYNC_STORAGE_KEY || !event.newValue) return;
    try { listener(JSON.parse(event.newValue)); } catch { /* Ignore malformed sync payloads. */ }
  };

  if (typeof BroadcastChannel === 'function') {
    try {
      channel = new BroadcastChannel(MEETING_SYNC_CHANNEL);
      channel.addEventListener('message', handleMessage);
    } catch {
      channel = null;
    }
  }
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener('storage', handleStorage);
    try { channel?.removeEventListener('message', handleMessage); } catch { /* Best-effort cleanup. */ }
    try { channel?.close(); } catch { /* Best-effort cleanup. */ }
  };
}

function validateInput(input) {
  const rawTitle = String(input?.title ?? '');
  const title = rawTitle.trim();
  const accessMode = String(input?.accessMode ?? '');

  if ((rawTitle.length > 0 && !title) || title.length > MEETING_TITLE_MAX_LENGTH) {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.INVALID_TITLE };
  }
  if (accessMode !== SUPPORTED_ACCESS_MODE) {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.CREATE_MEETING_FAILED };
  }

  return {
    success: true,
    input: {
      title: title || 'Cuộc họp của bạn',
      accessMode,
      waitingRoomEnabled: WAITING_ROOM_DEFAULT_ENABLED,
      maxParticipants: MAX_MEETING_PARTICIPANTS
    }
  };
}

export async function createMeeting(input) {
  const validation = validateInput(input);
  if (!validation.success) return validation;

  const authenticatedUser = getAuthenticatedUser();
  if (!authenticatedUser) return { success: false, code: CREATE_MEETING_ERROR_CODES.AUTH_REQUIRED };
  if (!validateMeetingDisplayName(authenticatedUser.displayName).valid) {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.INVALID_DISPLAY_NAME };
  }
  if (!configState.hasSupabase) return { success: false, code: CREATE_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  const remote = await createRemoteMeeting(validation.input, authenticatedUser);
  if (remote.backendMissing) return { success: false, code: CREATE_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  if (remote.errorCode) return { success: false, code: remote.errorCode };
  return { success: true, meeting: remote.meeting, participant: remote.participant };
}

export async function createInstantMeeting(currentUser = null) {
  const user = getAuthenticatedUser(currentUser);
  if (!user) return { success: false, code: CREATE_MEETING_ERROR_CODES.AUTH_REQUIRED };
  if (!validateMeetingDisplayName(user.displayName).valid) {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.INVALID_DISPLAY_NAME };
  }
  if (!configState.hasSupabase) return { success: false, code: CREATE_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  const remote = await createRemoteMeeting({
    title: `Cuộc họp của ${user.displayName}`,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    waitingRoomEnabled: WAITING_ROOM_DEFAULT_ENABLED
  }, user);
  if (remote.backendMissing) return { success: false, code: CREATE_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  if (remote.errorCode) return { success: false, code: remote.errorCode };
  return { success: true, meeting: remote.meeting, participant: { ...remote.participant, status: 'pending' } };
}

function getCurrentUser() {
  const session = getSession();
  if (!session?.id) return null;
  return { id: session.id, displayName: normalizeMeetingDisplayName(session.displayName) };
}

function getAuthenticatedUser(userInput = null) {
  const source = userInput || getSession();
  const id = String(source?.id || '').trim();
  if (!id) return null;
  return {
    id,
    displayName: normalizeMeetingDisplayName(source?.displayName)
  };
}

function normalizeRemoteMeeting(value) {
  return normalizeMeeting(value);
}

function getRemoteMeetingResult(data) {
  const meeting = normalizeRemoteMeeting(data);
  return meeting ? { usable: true, meeting } : { usable: false, missing: true };
}

async function getRemoteMeeting(roomCode) {
  const result = await callRemoteRpc('flash_meeting_get_meeting', { p_room_code: roomCode });
  if (!result.available) return { usable: false, backendMissing: true };
  if (result.error) {
    return isRemoteBackendMissing(result.error)
      ? { usable: false, backendMissing: true }
      : { usable: false, error: result.error };
  }
  return getRemoteMeetingResult(result.data);
}

async function joinRemoteMeeting(roomCode, displayName) {
  const displayNameValidation = validateMeetingDisplayName(displayName);
  if (!displayNameValidation.valid) return { errorCode: JOIN_MEETING_ERROR_CODES.INVALID_DISPLAY_NAME };
  const result = await callRemoteRpc('flash_meeting_join_meeting', {
    p_room_code: roomCode,
    p_display_name: displayNameValidation.value,
    p_session_id: getMeetingSessionId()
  });
  if (!result.available || isRemoteBackendMissing(result.error)) return { backendMissing: true };
  if (result.error) {
    return { errorCode: mapMeetingRpcError(result.error, JOIN_MEETING_ERROR_CODES.JOIN_FAILED), error: result.error };
  }
  let payload = result.data;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return { errorCode: JOIN_MEETING_ERROR_CODES.JOIN_FAILED }; }
  }
  const meeting = normalizeRemoteMeeting(payload?.meeting);
  if (!meeting || !payload?.participant) return { errorCode: JOIN_MEETING_ERROR_CODES.JOIN_FAILED };
  const participantName = validateMeetingDisplayName(payload.participant.displayName || payload.participant.display_name);
  if (!participantName.valid) return { errorCode: JOIN_MEETING_ERROR_CODES.INVALID_DISPLAY_NAME };
  const participant = {
    ...payload.participant,
    userId: payload.participant.userId || payload.participant.user_id,
    displayName: participantName.value,
    role: payload.participant.role || PARTICIPANT_ROLES.MEMBER,
    status: payload.participant.status || 'admitted'
  };
  const participantContext = {
    ...getCurrentParticipantContext(roomCode, meeting),
    meeting,
    participant,
    role: participant.role,
    isHost: participant.role === PARTICIPANT_ROLES.HOST,
    isCoHost: participant.role === PARTICIPANT_ROLES.CO_HOST,
    isMember: participant.role === PARTICIPANT_ROLES.MEMBER,
    requiresWaitingRoom: payload.destination === ADMISSION_DESTINATIONS.WAITING_ROOM
  };
  return {
    result: buildParticipantResult(meeting, participantContext, participant,
      payload.destination || ADMISSION_DESTINATIONS.MEETING)
  };
}

async function createRemoteMeeting(input, user) {
  const result = await callRemoteRpc('flash_meeting_create_meeting', {
    p_title: input.title,
    p_max_participants: input.maxParticipants,
    p_waiting_room_enabled: input.waitingRoomEnabled
  });
  if (!result.available || isRemoteBackendMissing(result.error)) return { backendMissing: true };
  if (result.error) {
    return { errorCode: mapMeetingRpcError(result.error, CREATE_MEETING_ERROR_CODES.CREATE_MEETING_FAILED), error: result.error };
  }

  const meeting = normalizeRemoteMeeting(result.data);
  if (!meeting) return { errorCode: CREATE_MEETING_ERROR_CODES.CREATE_MEETING_FAILED };
  return {
    meeting,
    participant: {
      userId: user.id,
      role: PARTICIPANT_ROLES.HOST,
      status: 'admitted',
      displayName: user.displayName
    }
  };
}

async function listRemoteMeetings(limit = DEFAULT_HISTORY_LIMIT) {
  const result = await callRemoteRpc('flash_meeting_list_my_meetings', { p_limit: limit });
  if (!result.available || isRemoteBackendMissing(result.error)) return { backendMissing: true };
  if (result.error) return { error: result.error };
  const rawMeetings = Array.isArray(result.data) ? result.data : [];
  return { meetings: rawMeetings.map(normalizeRemoteMeeting).filter(Boolean) };
}

function buildParticipantResult(meeting, participantContext, participant, destination = ADMISSION_DESTINATIONS.MEETING) {
  return {
    success: true,
    meeting,
    participant,
    participantContext: {
      ...participantContext,
      meeting,
      participant,
      requiresWaitingRoom: destination === ADMISSION_DESTINATIONS.WAITING_ROOM
    },
    destination,
    requiresWaitingRoom: destination === ADMISSION_DESTINATIONS.WAITING_ROOM
  };
}

function getStoredParticipant(roomCode) {
  const currentUser = getCurrentUser();
  if (!currentUser) return null;
  try {
    const storedMeeting = normalizeMeeting(JSON.parse(sessionStorage.getItem('flashMeeting.joinedMeeting') || 'null'));
    if (!storedMeeting || normalizeRoomCode(storedMeeting.roomCode) !== normalizeRoomCode(roomCode)) return null;
    const storedParticipant = JSON.parse(sessionStorage.getItem('flashMeeting.joinedParticipant') || 'null');
    const participantUserId = String(storedParticipant?.userId || storedParticipant?.user_id || '').trim();
    return participantUserId === currentUser.id ? storedParticipant : null;
  } catch {
    return null;
  }
}

export function getCurrentParticipantContext(roomCode, meetingInput = null) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const meeting = meetingInput || getStoredMeeting(normalizedRoomCode);
  if (!meeting) {
    return {
      meeting: null,
      participant: null,
      role: null,
      isHost: false,
      isCoHost: false,
      isMember: false,
      requiresWaitingRoom: false
    };
  }

  const currentUser = getCurrentUser();
  const establishedParticipant = getStoredParticipant(normalizedRoomCode);
  const participant = meeting.hostId && meeting.hostId === currentUser?.id
    ? {
      userId: currentUser.id,
      role: PARTICIPANT_ROLES.HOST,
      status: meeting.status === MEETING_STATUSES.PREPARING ? 'pending' : 'admitted'
    }
    : establishedParticipant
      ? { ...establishedParticipant }
      : currentUser
        ? { userId: currentUser.id, role: PARTICIPANT_ROLES.MEMBER, status: 'pending' }
        : null;
  if (!participant) {
    return {
      meeting,
      participant: null,
      role: null,
      isHost: false,
      isCoHost: false,
      isMember: false,
      requiresWaitingRoom: false
    };
  }
  const isHost = participant.role === PARTICIPANT_ROLES.HOST;
  const isCoHost = participant.role === PARTICIPANT_ROLES.CO_HOST;

  return {
    meeting,
    participant,
    role: participant.role,
    isHost,
    isCoHost,
    isMember: participant.role === PARTICIPANT_ROLES.MEMBER,
    requiresWaitingRoom: Boolean(meeting.waitingRoomEnabled && !isHost && !isCoHost)
  };
}

export function getAdmissionDestination(context = {}) {
  const meeting = context.meeting;
  if (!meeting) return ADMISSION_DESTINATIONS.NOT_FOUND;
  if ([MEETING_STATUSES.ENDING, MEETING_STATUSES.ENDED, MEETING_STATUSES.CANCELLED].includes(meeting.status)) {
    return ADMISSION_DESTINATIONS.ENDED;
  }
  if (meeting.status === MEETING_STATUSES.LOCKED) return ADMISSION_DESTINATIONS.BLOCKED;
  if (context.isHost || context.isCoHost) return ADMISSION_DESTINATIONS.MEETING;
  if (Number(meeting.participantCount ?? 0) >= Number(meeting.maxParticipants ?? MAX_MEETING_PARTICIPANTS)) {
    return ADMISSION_DESTINATIONS.ROOM_FULL;
  }
  return context.requiresWaitingRoom ? ADMISSION_DESTINATIONS.WAITING_ROOM : ADMISSION_DESTINATIONS.MEETING;
}

function getStoredMeeting(roomCode) {
  try {
    const storedMeetings = [
      JSON.parse(sessionStorage.getItem('flashMeeting.joinedMeeting') || 'null'),
      JSON.parse(sessionStorage.getItem('flashMeeting.createdMeeting') || 'null')
    ];
    return storedMeetings
      .map(normalizeMeeting)
      .find((meeting) => normalizeRoomCode(meeting?.roomCode) === roomCode) || null;
  } catch {
    return null;
  }
}

export function getMeeting(roomCode) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  return isLikelyRoomCode(normalizedRoomCode) ? getStoredMeeting(normalizedRoomCode) : null;
}

export async function listActiveMeetings(currentUser = null) {
  const user = getAuthenticatedUser(currentUser);
  if (!user) return [];
  if (!configState.hasSupabase) throw Object.assign(new Error('SERVICE_UNAVAILABLE'), { code: 'SERVICE_UNAVAILABLE' });
  const remote = await listRemoteMeetings(50);
  if (!remote.meetings) throw Object.assign(new Error('SERVICE_UNAVAILABLE'), { code: 'SERVICE_UNAVAILABLE' });
  return remote.meetings
    .filter((meeting) => meeting.hostId === user.id && meeting.status === MEETING_STATUSES.ACTIVE && toTimestamp(meeting.startedAt))
    .map((meeting) => ({
      ...meeting,
      displayDate: 'Đang diễn ra',
      displayTime: new Date(meeting.startedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    }));
}

export async function listMeetingHistory(currentUser = null, limit = DEFAULT_HISTORY_LIMIT) {
  const user = getAuthenticatedUser(currentUser);
  if (!user) return [];

  const safeLimit = Number.isFinite(Number(limit))
    ? Math.max(0, Math.floor(Number(limit)))
    : DEFAULT_HISTORY_LIMIT;
  if (!configState.hasSupabase) throw Object.assign(new Error('SERVICE_UNAVAILABLE'), { code: 'SERVICE_UNAVAILABLE' });
  const remote = await listRemoteMeetings(Math.max(safeLimit, 50));
  if (!remote.meetings) throw Object.assign(new Error('SERVICE_UNAVAILABLE'), { code: 'SERVICE_UNAVAILABLE' });
  return remote.meetings
    .filter((meeting) => meeting.hostId === user.id && meeting.status === MEETING_STATUSES.ENDED)
    .sort((left, right) => (
      (toTimestamp(right.endedAt) || toTimestamp(right.startedAt) || 0)
      - (toTimestamp(left.endedAt) || toTimestamp(left.startedAt) || 0)
    ))
    .slice(0, safeLimit);
}

export async function startMeeting({ roomCode, displayName } = {}) {
  const user = getAuthenticatedUser();
  if (!user) return { success: false, code: START_MEETING_ERROR_CODES.AUTH_REQUIRED };
  const selectedDisplayName = displayName === undefined ? user.displayName : normalizeMeetingDisplayName(displayName);
  if (!validateMeetingDisplayName(selectedDisplayName).valid) {
    return { success: false, code: START_MEETING_ERROR_CODES.INVALID_DISPLAY_NAME };
  }

  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!isLikelyRoomCode(normalizedRoomCode)) {
    return { success: false, code: START_MEETING_ERROR_CODES.INVALID_ROOM_CODE };
  }

  if (!configState.hasSupabase) return { success: false, code: START_MEETING_ERROR_CODES.START_MEETING_FAILED };
  const membership = await joinRemoteMeeting(normalizedRoomCode, selectedDisplayName);
  if (membership.backendMissing) return { success: false, code: START_MEETING_ERROR_CODES.START_MEETING_FAILED };
  if (membership.errorCode) return { success: false, code: membership.errorCode };
  const remote = await callRemoteRpc('flash_meeting_start_meeting', { p_room_code: normalizedRoomCode });
  if (!remote.available || isRemoteBackendMissing(remote.error)) {
    return { success: false, code: START_MEETING_ERROR_CODES.START_MEETING_FAILED };
  }
  if (remote.error) {
    const mappedCode = mapMeetingRpcError(remote.error, START_MEETING_ERROR_CODES.START_MEETING_FAILED);
    return { success: false, code: START_MEETING_ERROR_CODES[mappedCode] || mappedCode };
  }
  const activeMeeting = normalizeRemoteMeeting(remote.data);
  if (!activeMeeting) return { success: false, code: START_MEETING_ERROR_CODES.START_MEETING_FAILED };
  const participantContext = getCurrentParticipantContext(normalizedRoomCode, activeMeeting);
  const participant = {
    ...participantContext.participant,
    role: PARTICIPANT_ROLES.HOST,
    status: 'admitted',
    displayName: membership.result?.participant?.displayName || selectedDisplayName
  };
  const result = buildParticipantResult(activeMeeting, participantContext, participant);
  publishMeetingEvent('MEETING_STARTED', activeMeeting);
  return result;
}

export async function endMeeting({ roomCode } = {}) {
  if (!getAuthenticatedUser()) return { success: false, code: END_MEETING_ERROR_CODES.AUTH_REQUIRED };

  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!isLikelyRoomCode(normalizedRoomCode)) {
    return { success: false, code: END_MEETING_ERROR_CODES.INVALID_ROOM_CODE };
  }

  if (!configState.hasSupabase) return { success: false, code: END_MEETING_ERROR_CODES.END_MEETING_FAILED };
  const remote = await callRemoteRpc('flash_meeting_end_meeting', { p_room_code: normalizedRoomCode });
  if (!remote.available || isRemoteBackendMissing(remote.error)) {
    return { success: false, code: END_MEETING_ERROR_CODES.END_MEETING_FAILED };
  }
  if (remote.error) {
    const mappedCode = mapMeetingRpcError(remote.error, END_MEETING_ERROR_CODES.END_MEETING_FAILED);
    return { success: false, code: END_MEETING_ERROR_CODES[mappedCode] || mappedCode };
  }
  const endedMeeting = normalizeRemoteMeeting(remote.data);
  if (!endedMeeting) return { success: false, code: END_MEETING_ERROR_CODES.END_MEETING_FAILED };
  const participantContext = getCurrentParticipantContext(normalizedRoomCode, endedMeeting);
  publishMeetingEvent('MEETING_ENDED', endedMeeting);
  return {
    success: true,
    meeting: endedMeeting,
    participantContext: {
      ...participantContext,
      meeting: endedMeeting
    }
  };
}

export async function getWaitingRoom(input) {
  const roomCode = normalizeRoomCode(input?.roomCode);
  if (!isLikelyRoomCode(roomCode)) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.INVALID_ROOM_CODE };
  }
  const displayNameValidation = validateMeetingDisplayName(input?.displayName);
  if (!displayNameValidation.valid) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.INVALID_DISPLAY_NAME };
  }
  if (!configState.hasSupabase) return { success: false, code: JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };

  const remote = await getRemoteMeeting(roomCode);
  if (remote.backendMissing) return { success: false, code: JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  if (remote.error) {
    const mappedCode = mapMeetingRpcError(remote.error, JOIN_MEETING_ERROR_CODES.JOIN_FAILED);
    return { success: false, code: JOIN_MEETING_ERROR_CODES[mappedCode] || mappedCode };
  }
  if (!remote.meeting) return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_NOT_FOUND };
  const meeting = remote.meeting;

  const participantContext = getCurrentParticipantContext(roomCode, meeting);
  const remoteState = await callRemoteRpc('flash_meeting_get_my_participant', {
    p_room_code: roomCode,
    p_session_id: getMeetingSessionId()
  });
  if (!remoteState.available) return { success: false, code: JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  if (remoteState.error) {
    const mappedCode = mapMeetingRpcError(remoteState.error, JOIN_MEETING_ERROR_CODES.JOIN_FAILED);
    return { success: false, code: JOIN_MEETING_ERROR_CODES[mappedCode] || mappedCode };
  }
  let payload = remoteState.data;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return { success: false, code: JOIN_MEETING_ERROR_CODES.JOIN_FAILED }; }
  }
  const remoteParticipant = payload?.participant;
  if (remoteParticipant && remoteParticipant.status !== 'left') {
    const nextContext = {
      ...participantContext,
      meeting,
      participant: remoteParticipant,
      role: remoteParticipant.role,
      isHost: remoteParticipant.role === PARTICIPANT_ROLES.HOST,
      isCoHost: remoteParticipant.role === PARTICIPANT_ROLES.CO_HOST,
      isMember: remoteParticipant.role === PARTICIPANT_ROLES.MEMBER
    };
    if (nextContext.isHost || nextContext.isCoHost) {
      return { success: true, meeting, participant: remoteParticipant, participantContext: nextContext, destination: ADMISSION_DESTINATIONS.MEETING, request: null };
    }
    const destination = payload.destination || ADMISSION_DESTINATIONS.WAITING_ROOM;
    return {
      success: true,
      meeting,
      request: { roomCode, meetingTitle: meeting.title, hostName: meeting.hostName || '', displayName: remoteParticipant.displayName, status: remoteParticipant.status },
      participant: remoteParticipant,
      participantContext: { ...nextContext, requiresWaitingRoom: destination === ADMISSION_DESTINATIONS.WAITING_ROOM },
      destination
    };
  }

  const remoteJoin = await joinRemoteMeeting(roomCode, displayNameValidation.value);
  if (remoteJoin.backendMissing) return { success: false, code: JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  if (remoteJoin.errorCode) return { success: false, code: JOIN_MEETING_ERROR_CODES[remoteJoin.errorCode] || remoteJoin.errorCode };
  if (remoteJoin.result?.destination === ADMISSION_DESTINATIONS.MEETING) return { ...remoteJoin.result, request: null };
  if (remoteJoin.result) {
    return {
      ...remoteJoin.result,
      request: {
        roomCode,
        meetingTitle: remoteJoin.result.meeting.title,
        hostName: remoteJoin.result.meeting.hostName || '',
        displayName: remoteJoin.result.participant.displayName,
        status: remoteJoin.result.participant.status
      }
    };
  }
  return { success: false, code: JOIN_MEETING_ERROR_CODES.JOIN_FAILED };
}

export function watchWaitingRequest({ roomCode, status, onChange, onError } = {}) {
  if (!configState.hasSupabase || (status !== WAITING_REQUEST_STATUSES.WAITING && status !== 'reconnecting')) {
    if (!configState.hasSupabase) onError?.({ code: JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE });
    return () => {};
  }
  let cancelled = false;
  let unsubscribe = null;
  (async () => {
    const remote = await getRemoteMeeting(normalizeRoomCode(roomCode));
    if (cancelled) return;
    if (remote.backendMissing) {
      onError?.({ code: JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE });
      return;
    }
    if (remote.error || !remote.meeting) {
      onError?.({ code: remote.error ? mapMeetingRpcError(remote.error, JOIN_MEETING_ERROR_CODES.NETWORK_ERROR) : JOIN_MEETING_ERROR_CODES.MEETING_NOT_FOUND });
      return;
    }
    unsubscribe = subscribeMeetingParticipants({
      meetingId: remote.meeting.id,
      onChange: (participant) => {
        if (cancelled || participant?.userId !== getCurrentUser()?.id || participant.sessionId !== getMeetingSessionId()) return;
        const nextStatus = participant.status === 'admitted'
          ? WAITING_REQUEST_STATUSES.APPROVED
          : participant.status === 'rejected'
            ? WAITING_REQUEST_STATUSES.REJECTED
            : participant.status === 'removed'
              ? WAITING_REQUEST_STATUSES.REMOVED
              : participant.status === 'left'
                ? WAITING_REQUEST_STATUSES.MEETING_ENDED
                : WAITING_REQUEST_STATUSES.WAITING;
        onChange?.({ status: nextStatus, participant });
      },
      onError
    });
  })().catch((error) => onError?.({ code: mapMeetingRpcError(error, JOIN_MEETING_ERROR_CODES.NETWORK_ERROR) }));
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

export async function withdrawWaitingRequest({ roomCode } = {}) {
  if (!configState.hasSupabase) return { success: false, code: JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  const remote = await getRemoteMeeting(normalizeRoomCode(roomCode));
  if (remote.backendMissing || !remote.meeting) return { success: false, code: JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  const result = await leaveRemoteMeeting(remote.meeting.id, getMeetingSessionId());
  return result.success ? { success: true, status: 'withdrawn' } : result;
}

export async function leaveMeetingSession({ meetingId, sessionId = getMeetingSessionId() } = {}) {
  const result = await callRemoteRpc('flash_meeting_leave_meeting', {
    p_meeting_id: meetingId,
    p_session_id: sessionId
  });
  if (!result.available) return { success: false, code: JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  if (result.error) return { success: false, code: mapMeetingRpcError(result.error, JOIN_MEETING_ERROR_CODES.NETWORK_ERROR) };
  return { success: true, participant: result.data };
}

export async function setMeetingMediaState({ meetingId, cameraEnabled, microphoneEnabled, handRaised = null, sessionId = getMeetingSessionId() } = {}) {
  const result = await callRemoteRpc('flash_meeting_set_media_state', {
    p_meeting_id: meetingId,
    p_session_id: sessionId,
    p_camera_enabled: Boolean(cameraEnabled),
    p_microphone_enabled: Boolean(microphoneEnabled),
    p_hand_raised: handRaised
  });
  if (!result.available) return { success: false, code: JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  if (result.error) return { success: false, code: mapMeetingRpcError(result.error, JOIN_MEETING_ERROR_CODES.NETWORK_ERROR) };
  return { success: true, participant: result.data };
}

export async function moderateMeetingParticipant({ meetingId, participantId, action, value = null } = {}) {
  const serverAction = {
    muteParticipant: 'mute',
    stopParticipantCamera: 'stop_camera',
    promoteToCoHost: 'promote',
    demoteCoHost: 'demote',
    setParticipantSharePermission: 'set_share_permission',
    removeParticipant: 'remove'
  }[action] || action;
  const result = await callRemoteRpc('flash_meeting_moderate_participant', {
    p_meeting_id: meetingId,
    p_participant_id: participantId,
    p_action: serverAction,
    p_value: value
  });
  if (!result.available) return { success: false, code: 'SERVICE_UNAVAILABLE' };
  if (result.error) return { success: false, code: mapMeetingRpcError(result.error, 'MODERATION_FAILED') };
  return { success: true, participant: result.data };
}

export async function resolveMeetingForJoin(input) {
  const isJoinAttempt = input?.phase === 'join';
  const displayNameValidation = validateMeetingDisplayName(input?.displayName);
  if (!displayNameValidation.valid) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.INVALID_DISPLAY_NAME };
  }

  const roomCode = normalizeRoomCode(input?.roomCode);
  if (!isLikelyRoomCode(roomCode)) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.INVALID_ROOM_CODE };
  }
  if (!configState.hasSupabase) return { success: false, code: JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };

  if (isJoinAttempt) {
    const remoteJoin = await joinRemoteMeeting(roomCode, displayNameValidation.value);
    if (remoteJoin.backendMissing) return { success: false, code: JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
    if (remoteJoin.errorCode) {
      return { success: false, code: JOIN_MEETING_ERROR_CODES[remoteJoin.errorCode] || remoteJoin.errorCode };
    }
    return remoteJoin.result || { success: false, code: JOIN_MEETING_ERROR_CODES.JOIN_FAILED };
  }
  const remote = await getRemoteMeeting(roomCode);
  if (remote.backendMissing) return { success: false, code: JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  if (remote.error) {
    const mappedCode = mapMeetingRpcError(remote.error, JOIN_MEETING_ERROR_CODES.JOIN_FAILED);
    return { success: false, code: JOIN_MEETING_ERROR_CODES[mappedCode] || mappedCode };
  }
  if (!remote.meeting) return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_NOT_FOUND };
  const meeting = remote.meeting;
  const participantContext = getCurrentParticipantContext(roomCode, meeting);
  return {
    success: true,
    meeting,
    participant: participantContext.participant,
    participantContext
  };
}

export const meetingService = Object.freeze({
  create: createMeeting,
  createInstantMeeting,
  startMeeting,
  endMeeting,
  listActiveMeetings,
  listMeetingHistory,
  getMeeting,
  subscribeMeetingEvents,
  resolveForJoin: resolveMeetingForJoin,
  getCurrentParticipantContext,
  getAdmissionDestination,
  getWaitingRoom,
  watchWaitingRequest,
  withdrawWaitingRequest,
  leaveMeetingSession,
  setMeetingMediaState,
  moderateMeetingParticipant
});
