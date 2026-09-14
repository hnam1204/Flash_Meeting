import { getSession, MOCK_USER_ID } from './auth-service.js';
import { configState } from './config.js';
import { isLikelyRoomCode, normalizeRoomCode } from './utils.js';

export const MAX_MEETING_PARTICIPANTS = 50;
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
  INVALID_TITLE: 'INVALID_TITLE',
  RATE_LIMITED: 'RATE_LIMITED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  CREATE_MEETING_FAILED: 'CREATE_MEETING_FAILED'
});

export const START_MEETING_ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: 'AUTH_REQUIRED',
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

const MOCK_DELAY = 620;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CREATED_MEETING_KEY = 'flashMeeting.createdMeeting';
const MOCK_MEETINGS_KEY = 'flashMeeting.mockMeetings';
const MAX_STORED_ENDED_MEETINGS = 50;
const DEFAULT_HISTORY_LIMIT = 5;
const WAITING_REQUEST_KEY = 'flashMeeting.waitingRequest';
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
  if (message.includes('MEETING_NOT_FOUND')) return 'MEETING_NOT_FOUND';
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

function wait(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function getMockScenario() {
  const scenario = new URLSearchParams(window.location.search).get('mock');
  return String(scenario ?? '').toLowerCase();
}

function shouldUseRemoteBackend() {
  return configState.hasSupabase && !getMockScenario();
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
    endedAt: toTimestamp(meeting.endedAt ?? meeting.ended_at)
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

const MOCK_REFERENCE_NOW = Date.now();
const MOCK_ACTIVE_CREATED_AT = MOCK_REFERENCE_NOW - (35 * 60 * 1000);
const MOCK_ACTIVE_STARTED_AT = MOCK_REFERENCE_NOW - (27 * 60 * 1000);
const MOCK_ENDED_STARTED_AT = MOCK_REFERENCE_NOW - (90 * 60 * 1000);
const MOCK_ENDED_AT = MOCK_REFERENCE_NOW - (22 * 60 * 1000);

function generateMockRoomCode() {
  const values = new Uint32Array(9);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
  } else {
    values.forEach((_, index) => { values[index] = Math.floor(Math.random() * 0xffffffff); });
  }
  const code = Array.from(values, (value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join('');
  return `${code.slice(0, 3)}-${code.slice(3, 6)}-${code.slice(6)}`;
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
  await wait(MOCK_DELAY);

  const scenario = getMockScenario();
  if (scenario === 'rate-limit' || scenario === 'rate-limited') {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.RATE_LIMITED };
  }
  if (scenario === 'network' || scenario === 'network-error' || scenario === 'offline') {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.NETWORK_ERROR };
  }
  if (scenario === 'service-error' || scenario === 'service-unavailable') {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  }
  if (scenario === 'create-error' || scenario === 'error') {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.CREATE_MEETING_FAILED };
  }
  const validation = validateInput(input);
  if (!validation.success) return validation;

  const authenticatedUser = getAuthenticatedUser();
  if (authenticatedUser && shouldUseRemoteBackend()) {
    const remote = await createRemoteMeeting(validation.input, authenticatedUser);
    if (!remote.backendMissing) {
      if (remote.errorCode) return { success: false, code: remote.errorCode };
      return { success: true, meeting: remote.meeting, participant: remote.participant };
    }
  }

  // SECURITY: generate and validate the room code again in trusted server logic later.
  return {
    success: true,
    meeting: {
      id: `mock-meeting-${Date.now()}`,
      roomCode: generateMockRoomCode(),
      title: validation.input.title,
      status: MEETING_STATUSES.PREPARING,
      accessMode: validation.input.accessMode,
      maxParticipants: MAX_MEETING_PARTICIPANTS,
      waitingRoomEnabled: WAITING_ROOM_DEFAULT_ENABLED,
      hostId: getCurrentUser().id,
      hostName: getCurrentUser().displayName,
      participantCount: 1,
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null
    },
    participant: {
      userId: getCurrentUser().id,
      role: PARTICIPANT_ROLES.HOST,
      status: 'admitted',
      displayName: getCurrentUser().displayName
    }
  };
}

export async function createInstantMeeting(currentUser = null) {
  await wait(MOCK_DELAY);

  const scenario = getMockScenario();
  if (scenario === 'rate-limit' || scenario === 'rate-limited') {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.RATE_LIMITED };
  }
  if (scenario === 'network' || scenario === 'network-error' || scenario === 'offline') {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.NETWORK_ERROR };
  }
  if (scenario === 'service-error' || scenario === 'service-unavailable') {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  }
  if (scenario === 'create-error' || scenario === 'error') {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.CREATE_MEETING_FAILED };
  }

  const user = getAuthenticatedUser(currentUser);
  if (!user) return { success: false, code: CREATE_MEETING_ERROR_CODES.AUTH_REQUIRED };

  if (shouldUseRemoteBackend()) {
    const remote = await createRemoteMeeting({
      title: user.displayName === 'Khách tham gia' ? 'Cuộc họp nhanh' : `Cuộc họp của ${user.displayName}`,
      maxParticipants: MAX_MEETING_PARTICIPANTS,
      waitingRoomEnabled: WAITING_ROOM_DEFAULT_ENABLED
    }, user);
    if (!remote.backendMissing) {
      if (remote.errorCode) return { success: false, code: remote.errorCode };
      return { success: true, meeting: remote.meeting, participant: { ...remote.participant, status: 'pending' } };
    }
  }

  const now = Date.now();
  const existingRoomCodes = new Set(listStoredMeetings().map((meeting) => normalizeRoomCode(meeting?.roomCode)));
  let roomCode = generateMockRoomCode();
  while (existingRoomCodes.has(roomCode)) roomCode = generateMockRoomCode();

  const meeting = persistMockMeeting({
    id: `mock-instant-meeting-${now}`,
    roomCode,
    title: user.displayName === 'Khách tham gia' ? 'Cuộc họp nhanh' : `Cuộc họp của ${user.displayName}`,
    status: MEETING_STATUSES.PREPARING,
    accessMode: SUPPORTED_ACCESS_MODE,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    waitingRoomEnabled: WAITING_ROOM_DEFAULT_ENABLED,
    hostId: user.id,
    hostName: user.displayName,
    participantCount: 0,
    createdAt: now,
    startedAt: null,
    endedAt: null
  });

  return {
    success: true,
    meeting,
    participant: {
      userId: user.id,
      role: PARTICIPANT_ROLES.HOST,
      status: 'pending',
      displayName: user.displayName
    }
  };
}

const MOCK_JOIN_MEETINGS = Object.freeze({
  'ABC-123-XYZ': {
    id: 'mock-meeting-abc-123-xyz',
    title: 'Cuộc họp nhóm sản phẩm',
    hostName: 'Nguyễn Hải Nam',
    hostId: 'mock-host-abc-123-xyz',
    status: 'active',
    createdAt: MOCK_ACTIVE_CREATED_AT,
    startedAt: MOCK_ACTIVE_STARTED_AT,
    endedAt: null,
    waitingRoomEnabled: false,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: 8
  },
  'FLASH-101': {
    id: 'mock-meeting-flash-101',
    title: 'Weekly Flash Meeting',
    hostName: 'Nguyễn Hải Nam',
    hostId: 'mock-host-flash-101',
    status: 'active',
    createdAt: MOCK_ACTIVE_CREATED_AT,
    startedAt: MOCK_ACTIVE_STARTED_AT,
    endedAt: null,
    waitingRoomEnabled: true,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: 12
  },
  'DESIGN-204': {
    id: 'mock-meeting-design-204',
    title: 'Design review',
    hostName: 'Linh Trần',
    hostId: 'mock-host-design-204',
    status: 'active',
    createdAt: MOCK_ACTIVE_CREATED_AT,
    startedAt: MOCK_ACTIVE_STARTED_AT,
    endedAt: null,
    waitingRoomEnabled: false,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: 6
  },
  'COHOST-123': {
    id: 'mock-meeting-cohost-123',
    title: 'Cuộc họp có Co-host',
    hostName: 'Linh Trần',
    hostId: 'mock-host-cohost-123',
    status: 'active',
    createdAt: MOCK_ACTIVE_CREATED_AT,
    startedAt: MOCK_ACTIVE_STARTED_AT,
    endedAt: null,
    waitingRoomEnabled: true,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: 4
  },
  'ENDED-123': {
    id: 'mock-meeting-ended-123',
    title: 'Cuộc họp đã kết thúc',
    hostName: 'Linh Trần',
    hostId: 'mock-host-ended-123',
    status: 'ended',
    createdAt: MOCK_ENDED_STARTED_AT,
    startedAt: MOCK_ENDED_STARTED_AT,
    endedAt: MOCK_ENDED_AT,
    waitingRoomEnabled: false,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: 10
  },
  'CANCEL-123': {
    id: 'mock-meeting-cancel-123',
    title: 'Cuộc họp đã hủy',
    hostName: 'Linh Trần',
    hostId: 'mock-host-cancel-123',
    status: 'cancelled',
    createdAt: MOCK_ACTIVE_CREATED_AT,
    startedAt: null,
    endedAt: null,
    waitingRoomEnabled: false,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: 0
  },
  'LOCKED-123': {
    id: 'mock-meeting-locked-123',
    title: 'Cuộc họp đang khóa',
    hostName: 'Linh Trần',
    hostId: 'mock-host-locked-123',
    status: 'locked',
    createdAt: MOCK_ACTIVE_CREATED_AT,
    startedAt: MOCK_ACTIVE_STARTED_AT,
    endedAt: null,
    waitingRoomEnabled: false,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: 10
  },
  'FULL-123': {
    id: 'mock-meeting-full-123',
    title: 'Cuộc họp đã đủ người',
    hostName: 'Linh Trần',
    hostId: 'mock-host-full-123',
    status: 'active',
    createdAt: MOCK_ACTIVE_CREATED_AT,
    startedAt: MOCK_ACTIVE_STARTED_AT,
    endedAt: null,
    waitingRoomEnabled: false,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: MAX_MEETING_PARTICIPANTS
  },
  'BLOCKED-123': {
    id: 'mock-meeting-blocked-123',
    title: 'Cuộc họp giới hạn người tham gia',
    hostName: 'Linh Trần',
    hostId: 'mock-host-blocked-123',
    status: 'active',
    createdAt: MOCK_ACTIVE_CREATED_AT,
    startedAt: MOCK_ACTIVE_STARTED_AT,
    endedAt: null,
    waitingRoomEnabled: false,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: 10
  }
});

const MOCK_ESTABLISHED_PARTICIPANTS = Object.freeze({
  'COHOST-123': Object.freeze({
    [MOCK_USER_ID]: Object.freeze({
      userId: MOCK_USER_ID,
      role: PARTICIPANT_ROLES.CO_HOST,
      status: 'admitted'
    })
  })
});

function getCurrentUser() {
  const session = getSession();
  return {
    id: session?.id || MOCK_USER_ID,
    displayName: String(session?.displayName || 'Khách tham gia').trim() || 'Khách tham gia'
  };
}

function getAuthenticatedUser(userInput = null) {
  const source = userInput || getSession();
  const id = String(source?.id || '').trim();
  if (!id) return null;
  return {
    id,
    displayName: String(source?.displayName || '').trim() || 'Khách tham gia'
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
  return MOCK_ESTABLISHED_PARTICIPANTS[roomCode]?.[getCurrentUser().id] || null;
}

export function getCurrentParticipantContext(roomCode, meetingInput = null) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const meeting = meetingInput || getJoinMeeting(normalizedRoomCode);
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
  const participant = meeting.hostId && meeting.hostId === currentUser.id
    ? {
      userId: currentUser.id,
      role: PARTICIPANT_ROLES.HOST,
      status: meeting.status === MEETING_STATUSES.PREPARING ? 'pending' : 'admitted'
    }
    : establishedParticipant
      ? { ...establishedParticipant }
      : { userId: currentUser.id, role: PARTICIPANT_ROLES.MEMBER, status: 'pending' };
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

function getJoinErrorScenario() {
  return String(new URLSearchParams(window.location.search).get('mock') ?? '').toLowerCase();
}

function readMockMeetings() {
  try {
    const meetings = JSON.parse(window.localStorage?.getItem(MOCK_MEETINGS_KEY) || '[]');
    return Array.isArray(meetings) ? meetings.map(normalizeMeeting).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeMockMeetings(meetings) {
  try {
    const activeOrPreparing = meetings.filter((meeting) => meeting.status !== MEETING_STATUSES.ENDED);
    const ended = meetings
      .filter((meeting) => meeting.status === MEETING_STATUSES.ENDED)
      .sort((left, right) => (
        (toTimestamp(right.endedAt) || toTimestamp(right.startedAt) || 0)
        - (toTimestamp(left.endedAt) || toTimestamp(left.startedAt) || 0)
      ))
      .slice(0, MAX_STORED_ENDED_MEETINGS);
    window.localStorage?.setItem(MOCK_MEETINGS_KEY, JSON.stringify([...activeOrPreparing, ...ended]));
  } catch {
    // Shared mock state is optional when browser storage is unavailable.
  }
}

function persistMockMeeting(meeting) {
  const normalizedMeeting = normalizeMeeting(meeting);
  if (!normalizedMeeting) return null;
  const meetings = readMockMeetings().filter((item) => item?.id !== normalizedMeeting.id);
  meetings.push(normalizedMeeting);
  writeMockMeetings(meetings);
  try {
    sessionStorage.setItem(CREATED_MEETING_KEY, JSON.stringify(normalizedMeeting));
  } catch {
    // Session storage is optional in mock mode.
  }
  return normalizedMeeting;
}

function listStoredMeetings() {
  const meetings = readMockMeetings();
  try {
    const currentMeeting = JSON.parse(sessionStorage.getItem(CREATED_MEETING_KEY) || 'null');
    const normalizedCurrentMeeting = normalizeMeeting(currentMeeting);
    if (normalizedCurrentMeeting?.id && !meetings.some((meeting) => meeting.id === normalizedCurrentMeeting.id)) {
      meetings.push(normalizedCurrentMeeting);
    }
  } catch {
    // Session storage is optional in mock mode.
  }
  return meetings;
}

function getStoredCreatedMeeting(roomCode) {
  try {
    const sharedMeeting = readMockMeetings().find((meeting) => normalizeRoomCode(meeting?.roomCode) === roomCode);
    if (sharedMeeting) return sharedMeeting;
    const storedMeeting = normalizeMeeting(JSON.parse(sessionStorage.getItem(CREATED_MEETING_KEY) ?? 'null'));
    return normalizeRoomCode(storedMeeting?.roomCode) === roomCode ? storedMeeting : null;
  } catch {
    return null;
  }
}

function getJoinMeeting(roomCode) {
  const storedMeeting = getStoredCreatedMeeting(roomCode);
  if (storedMeeting) {
    return {
      ...storedMeeting,
      roomCode,
      participantCount: Number(storedMeeting.participantCount ?? 0)
    };
  }

  const meeting = MOCK_JOIN_MEETINGS[roomCode];
  return meeting ? normalizeMeeting({ roomCode, ...meeting }) : null;
}

export function getMeeting(roomCode) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  return isLikelyRoomCode(normalizedRoomCode) ? getJoinMeeting(normalizedRoomCode) : null;
}

export async function listActiveMeetings(currentUser = null) {
  const user = getAuthenticatedUser(currentUser);
  if (!user) return [];

  if (shouldUseRemoteBackend()) {
    const remote = await listRemoteMeetings(50);
    if (remote.meetings) {
      return remote.meetings
        .filter((meeting) => meeting.hostId === user.id && meeting.status === MEETING_STATUSES.ACTIVE && toTimestamp(meeting.startedAt))
        .map((meeting) => ({
          ...meeting,
          displayDate: 'Đang diễn ra',
          displayTime: new Date(meeting.startedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        }));
    }
  }

  return listStoredMeetings()
    .filter((meeting) => meeting?.hostId === user.id
      && meeting.status === MEETING_STATUSES.ACTIVE
      && toTimestamp(meeting.startedAt))
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

  if (shouldUseRemoteBackend()) {
    const remote = await listRemoteMeetings(Math.max(safeLimit, 50));
    if (remote.meetings) {
      return remote.meetings
        .filter((meeting) => meeting.hostId === user.id && meeting.status === MEETING_STATUSES.ENDED)
        .sort((left, right) => (
          (toTimestamp(right.endedAt) || toTimestamp(right.startedAt) || 0)
          - (toTimestamp(left.endedAt) || toTimestamp(left.startedAt) || 0)
        ))
        .slice(0, safeLimit);
    }
  }

  return listStoredMeetings()
    .filter((meeting) => meeting?.hostId === user.id && meeting.status === MEETING_STATUSES.ENDED)
    .sort((left, right) => (
      (toTimestamp(right.endedAt) || toTimestamp(right.startedAt) || 0)
      - (toTimestamp(left.endedAt) || toTimestamp(left.startedAt) || 0)
    ))
    .slice(0, safeLimit);
}

export async function startMeeting({ roomCode } = {}) {
  await wait(MOCK_DELAY);

  const scenario = getMockScenario();
  if (scenario === 'network' || scenario === 'network-error' || scenario === 'offline') {
    return { success: false, code: START_MEETING_ERROR_CODES.NETWORK_ERROR };
  }
  if (scenario === 'start-error' || scenario === 'service-error' || scenario === 'service-unavailable') {
    return { success: false, code: START_MEETING_ERROR_CODES.START_MEETING_FAILED };
  }
  if (!getAuthenticatedUser()) return { success: false, code: START_MEETING_ERROR_CODES.AUTH_REQUIRED };

  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!isLikelyRoomCode(normalizedRoomCode)) {
    return { success: false, code: START_MEETING_ERROR_CODES.INVALID_ROOM_CODE };
  }

  if (shouldUseRemoteBackend()) {
    const remote = await callRemoteRpc('flash_meeting_start_meeting', { p_room_code: normalizedRoomCode });
    if (remote.available && !isRemoteBackendMissing(remote.error)) {
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
        displayName: getCurrentUser().displayName
      };
      const result = buildParticipantResult(activeMeeting, participantContext, participant);
      publishMeetingEvent('MEETING_STARTED', activeMeeting);
      return result;
    }
  }

  const meeting = getJoinMeeting(normalizedRoomCode);
  if (!meeting) return { success: false, code: START_MEETING_ERROR_CODES.MEETING_NOT_FOUND };

  const participantContext = getCurrentParticipantContext(normalizedRoomCode, meeting);
  if (!participantContext.isHost) {
    return { success: false, code: START_MEETING_ERROR_CODES.PERMISSION_DENIED };
  }
  if (meeting.status === MEETING_STATUSES.ACTIVE) {
    return {
      success: true,
      meeting,
      participant: { ...participantContext.participant, status: 'admitted' },
      participantContext
    };
  }
  if (meeting.status !== MEETING_STATUSES.PREPARING && meeting.status !== MEETING_STATUSES.SCHEDULED) {
    return { success: false, code: START_MEETING_ERROR_CODES.INVALID_STATE };
  }

  const activeMeeting = persistMockMeeting({
    ...meeting,
    status: MEETING_STATUSES.ACTIVE,
    participantCount: Math.max(1, Number(meeting.participantCount ?? 0)),
    startedAt: Date.now(),
    endedAt: null
  });
  publishMeetingEvent('MEETING_STARTED', activeMeeting);
  const participant = {
    ...participantContext.participant,
    role: PARTICIPANT_ROLES.HOST,
    status: 'admitted',
    displayName: getCurrentUser().displayName
  };

  return {
    success: true,
    meeting: activeMeeting,
    participant,
    participantContext: {
      ...participantContext,
      meeting: activeMeeting,
      participant
    },
    destination: ADMISSION_DESTINATIONS.MEETING
  };
}

export async function endMeeting({ roomCode } = {}) {
  await wait(MOCK_DELAY);

  const scenario = getMockScenario();
  if (scenario === 'network' || scenario === 'network-error' || scenario === 'offline') {
    return { success: false, code: END_MEETING_ERROR_CODES.NETWORK_ERROR };
  }
  if (scenario === 'end-error' || scenario === 'service-error' || scenario === 'service-unavailable') {
    return { success: false, code: END_MEETING_ERROR_CODES.END_MEETING_FAILED };
  }
  if (!getAuthenticatedUser()) return { success: false, code: END_MEETING_ERROR_CODES.AUTH_REQUIRED };

  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!isLikelyRoomCode(normalizedRoomCode)) {
    return { success: false, code: END_MEETING_ERROR_CODES.INVALID_ROOM_CODE };
  }

  if (shouldUseRemoteBackend()) {
    const remote = await callRemoteRpc('flash_meeting_end_meeting', { p_room_code: normalizedRoomCode });
    if (remote.available && !isRemoteBackendMissing(remote.error)) {
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
        participantContext: { ...participantContext, meeting: endedMeeting }
      };
    }
  }

  const meeting = getJoinMeeting(normalizedRoomCode);
  if (!meeting) return { success: false, code: END_MEETING_ERROR_CODES.MEETING_NOT_FOUND };

  const participantContext = getCurrentParticipantContext(normalizedRoomCode, meeting);
  if (!participantContext.isHost) {
    return { success: false, code: END_MEETING_ERROR_CODES.PERMISSION_DENIED };
  }
  if (meeting.status !== MEETING_STATUSES.ACTIVE) {
    return { success: false, code: END_MEETING_ERROR_CODES.INVALID_STATE };
  }

  const endedMeeting = persistMockMeeting({
    ...meeting,
    status: MEETING_STATUSES.ENDED,
    endedAt: Date.now()
  });
  if (!endedMeeting) return { success: false, code: END_MEETING_ERROR_CODES.END_MEETING_FAILED };
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

// TODO: expire stale PREPARING rooms server-side once the Supabase meeting backend exists.

function readWaitingRequest() {
  try {
    return JSON.parse(sessionStorage.getItem(WAITING_REQUEST_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeWaitingRequest(request) {
  try {
    sessionStorage.setItem(WAITING_REQUEST_KEY, JSON.stringify(request));
  } catch {
    // Session storage is optional in mock mode.
  }
}

function removeWaitingRequest() {
  try {
    sessionStorage.removeItem(WAITING_REQUEST_KEY);
  } catch {
    // Session storage is optional in mock mode.
  }
}

function getWaitingScenarioStatus(scenario, meeting) {
  if (scenario === 'room-full' || scenario === 'full' || meeting.participantCount >= Number(meeting.maxParticipants ?? MAX_MEETING_PARTICIPANTS)) {
    return WAITING_REQUEST_STATUSES.ROOM_FULL;
  }
  if (scenario === 'meeting-ended' || scenario === 'ended' || meeting.status === 'ended') {
    return WAITING_REQUEST_STATUSES.MEETING_ENDED;
  }
  if (scenario === 'meeting-locked' || scenario === 'locked' || meeting.status === 'locked') {
    return WAITING_REQUEST_STATUSES.MEETING_LOCKED;
  }
  if (scenario === 'user-blocked' || scenario === 'blocked') {
    return WAITING_REQUEST_STATUSES.REMOVED;
  }
  return '';
}

function createWaitingRequest(meeting, displayName, storedRequest = null) {
  if (storedRequest?.roomCode === meeting.roomCode && storedRequest.status !== 'withdrawn') {
    return {
      ...storedRequest,
      meetingTitle: meeting.title,
      hostName: meeting.hostName || storedRequest.hostName || '',
      displayName: String(displayName || storedRequest.displayName || 'Khách tham gia')
    };
  }

  return {
    roomCode: meeting.roomCode,
    meetingTitle: meeting.title,
    hostName: meeting.hostName || '',
    displayName: String(displayName || 'Khách tham gia'),
    status: WAITING_REQUEST_STATUSES.WAITING,
    createdAt: Date.now()
  };
}

export async function getWaitingRoom(input) {
  await wait(MOCK_DELAY);

  const scenario = getMockScenario();
  if (scenario === 'auth-required' || scenario === 'session-expired') {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.AUTH_REQUIRED };
  }
  if (scenario === 'network' || scenario === 'network-error' || scenario === 'offline') {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.NETWORK_ERROR };
  }
  if (scenario === 'service-error' || scenario === 'service-unavailable') {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  }

  const roomCode = normalizeRoomCode(input?.roomCode);
  if (!isLikelyRoomCode(roomCode)) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.INVALID_ROOM_CODE };
  }

  let meeting = null;
  if (shouldUseRemoteBackend()) {
    const remote = await getRemoteMeeting(roomCode);
    if (remote.usable) {
      meeting = remote.meeting;
    } else if (remote.error) {
      const mappedCode = mapMeetingRpcError(remote.error, JOIN_MEETING_ERROR_CODES.JOIN_FAILED);
      return { success: false, code: JOIN_MEETING_ERROR_CODES[mappedCode] || mappedCode };
    }
  }
  meeting ||= getJoinMeeting(roomCode);
  if (!meeting) return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_NOT_FOUND };

  const participantContext = getCurrentParticipantContext(roomCode, meeting);
  // SECURITY: Host/Co-host bypass is based on mock frontend state in this phase.
  // Production role/admission must be verified by trusted backend logic.
  if (participantContext.isHost || participantContext.isCoHost) {
    return {
      success: true,
      meeting,
      participant: participantContext.participant,
      participantContext,
      destination: ADMISSION_DESTINATIONS.MEETING,
      request: null
    };
  }

  const storedRequest = readWaitingRequest();
  const request = createWaitingRequest(meeting, input?.displayName, storedRequest);
  const scenarioStatus = getWaitingScenarioStatus(scenario, meeting);
  if (scenarioStatus) request.status = scenarioStatus;
  if (!storedRequest || storedRequest.roomCode !== roomCode || scenarioStatus) writeWaitingRequest(request);

  return {
    success: true,
    meeting,
    request,
    participant: participantContext.participant,
    participantContext,
    destination: ADMISSION_DESTINATIONS.WAITING_ROOM
  };
}

export function watchWaitingRequest({ roomCode, status, onChange, onError } = {}) {
  const participantContext = getCurrentParticipantContext(roomCode);
  if (participantContext.isHost || participantContext.isCoHost) return () => {};
  const scenario = getMockScenario();
  if (status !== WAITING_REQUEST_STATUSES.WAITING && status !== 'reconnecting') return () => {};

  const nextStatus = scenario === 'approved'
    ? WAITING_REQUEST_STATUSES.APPROVED
    : scenario === 'rejected'
      ? WAITING_REQUEST_STATUSES.REJECTED
      : '';
  const shouldFailReconnect = scenario === 'reconnect-failure';
  if (!nextStatus && !shouldFailReconnect && scenario !== 'reconnecting') return () => {};

  const timer = window.setTimeout(() => {
    if (shouldFailReconnect) {
      onError?.({ code: JOIN_MEETING_ERROR_CODES.NETWORK_ERROR });
      return;
    }
    const resolvedStatus = scenario === 'reconnecting' ? WAITING_REQUEST_STATUSES.WAITING : nextStatus;
    updateWaitingRequestStatus({ roomCode, status: resolvedStatus });
    onChange?.({ status: resolvedStatus });
  }, scenario === 'reconnecting' ? 950 : 760);

  return () => window.clearTimeout(timer);
}

export function updateWaitingRequestStatus({ roomCode, status } = {}) {
  if (!Object.values(WAITING_REQUEST_STATUSES).includes(status)) return false;
  const request = readWaitingRequest();
  if (!request || request.roomCode !== roomCode) return false;
  writeWaitingRequest({ ...request, status });
  return true;
}

export function withdrawWaitingRequest({ roomCode } = {}) {
  const request = readWaitingRequest();
  if (!request || request.roomCode === roomCode) removeWaitingRequest();
  return { success: true, status: 'withdrawn' };
}

export async function resolveMeetingForJoin(input) {
  await wait(MOCK_DELAY);

  const scenario = getJoinErrorScenario();
  const isJoinAttempt = input?.phase === 'join';
  if (scenario === 'auth-required' || scenario === 'session-expired') {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.AUTH_REQUIRED };
  }
  if (scenario === 'network' || scenario === 'network-error' || scenario === 'offline') {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.NETWORK_ERROR };
  }
  if (scenario === 'rate-limit' || scenario === 'rate-limited') {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.RATE_LIMITED };
  }
  if (scenario === 'service-error' || scenario === 'service-unavailable') {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE };
  }
  if (scenario === 'join-error' || scenario === 'error') {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.JOIN_FAILED };
  }
  if (isJoinAttempt && (scenario === 'room-full' || scenario === 'full')) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.ROOM_FULL };
  }
  if (isJoinAttempt && (scenario === 'meeting-ended' || scenario === 'ended')) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_ENDED };
  }
  if (isJoinAttempt && (scenario === 'meeting-cancelled' || scenario === 'cancelled')) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_CANCELLED };
  }
  if (isJoinAttempt && (scenario === 'meeting-locked' || scenario === 'locked')) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_LOCKED };
  }
  if (isJoinAttempt && (scenario === 'user-blocked' || scenario === 'blocked')) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.USER_BLOCKED };
  }

  const roomCode = normalizeRoomCode(input?.roomCode);
  if (!isLikelyRoomCode(roomCode)) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.INVALID_ROOM_CODE };
  }

  let meeting = null;
  if (shouldUseRemoteBackend()) {
    const remote = await getRemoteMeeting(roomCode);
    if (remote.usable) {
      meeting = remote.meeting;
    } else if (remote.error) {
      const mappedCode = mapMeetingRpcError(remote.error, JOIN_MEETING_ERROR_CODES.JOIN_FAILED);
      return { success: false, code: JOIN_MEETING_ERROR_CODES[mappedCode] || mappedCode };
    }
  }
  meeting ||= getJoinMeeting(roomCode);
  if (!meeting) return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_NOT_FOUND };
  if (scenario === 'waiting-room') meeting.waitingRoomEnabled = true;
  if (scenario === 'direct-join') meeting.waitingRoomEnabled = false;
  if ([MEETING_STATUSES.ENDING, MEETING_STATUSES.ENDED].includes(meeting.status)) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_ENDED };
  }
  if (meeting.status === MEETING_STATUSES.CANCELLED) return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_CANCELLED };
  if (meeting.status === MEETING_STATUSES.LOCKED) return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_LOCKED };
  if (roomCode === 'BLOCKED-123') return { success: false, code: JOIN_MEETING_ERROR_CODES.USER_BLOCKED };
  const participantContext = getCurrentParticipantContext(roomCode, meeting);
  if (isJoinAttempt && meeting.status === MEETING_STATUSES.PREPARING
    && !participantContext.isHost && !participantContext.isCoHost) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_NOT_STARTED };
  }
  if (!participantContext.isHost && !participantContext.isCoHost
    && meeting.participantCount >= Number(meeting.maxParticipants ?? MAX_MEETING_PARTICIPANTS)) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.ROOM_FULL };
  }

  const displayName = String(input?.displayName ?? '').trim() || 'Khách tham gia';
  const destination = getAdmissionDestination(participantContext);
  const participant = {
    ...participantContext.participant,
    displayName,
    status: destination === ADMISSION_DESTINATIONS.WAITING_ROOM ? 'waiting' : 'admitted'
  };
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
  updateWaitingRequestStatus,
  withdrawWaitingRequest
});
