import { isLikelyRoomCode, normalizeRoomCode } from './utils.js';

export const MAX_MEETING_PARTICIPANTS = 50;
export const DEFAULT_MEETING_PARTICIPANTS = MAX_MEETING_PARTICIPANTS;
export const MEETING_TITLE_MAX_LENGTH = 100;
export const SUPPORTED_ACCESS_MODE = 'link';

export const CREATE_MEETING_ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_TITLE: 'INVALID_TITLE',
  INVALID_CAPACITY: 'INVALID_CAPACITY',
  RATE_LIMITED: 'RATE_LIMITED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  CREATE_MEETING_FAILED: 'CREATE_MEETING_FAILED'
});

export const JOIN_MEETING_ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_ROOM_CODE: 'INVALID_ROOM_CODE',
  MEETING_NOT_FOUND: 'MEETING_NOT_FOUND',
  MEETING_ENDED: 'MEETING_ENDED',
  MEETING_CANCELLED: 'MEETING_CANCELLED',
  MEETING_LOCKED: 'MEETING_LOCKED',
  ROOM_FULL: 'ROOM_FULL',
  USER_BLOCKED: 'USER_BLOCKED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  JOIN_FAILED: 'JOIN_FAILED'
});

const MOCK_DELAY = 620;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function wait(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function getMockScenario() {
  const scenario = new URLSearchParams(window.location.search).get('mock');
  return String(scenario ?? '').toLowerCase();
}

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
  const maxParticipants = Number(input?.maxParticipants);

  if ((rawTitle.length > 0 && !title) || title.length > MEETING_TITLE_MAX_LENGTH) {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.INVALID_TITLE };
  }
  if (!Number.isInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > MAX_MEETING_PARTICIPANTS) {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.INVALID_CAPACITY };
  }
  if (accessMode !== SUPPORTED_ACCESS_MODE) {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.CREATE_MEETING_FAILED };
  }

  return {
    success: true,
    input: {
      title: title || 'Cuộc họp của bạn',
      accessMode,
      waitingRoomEnabled: Boolean(input?.waitingRoomEnabled),
      maxParticipants
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
  if (scenario === 'invalid-capacity') {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.INVALID_CAPACITY };
  }

  const validation = validateInput(input);
  if (!validation.success) return validation;

  // SECURITY: generate and validate the room code again in trusted server logic later.
  return {
    success: true,
    meeting: {
      id: `mock-meeting-${Date.now()}`,
      roomCode: generateMockRoomCode(),
      title: validation.input.title,
      status: 'scheduled',
      accessMode: validation.input.accessMode,
      maxParticipants: validation.input.maxParticipants,
      waitingRoomEnabled: validation.input.waitingRoomEnabled
    }
  };
}

const MOCK_JOIN_MEETINGS = Object.freeze({
  'ABC-123-XYZ': {
    id: 'mock-meeting-abc-123-xyz',
    title: 'Cuộc họp nhóm sản phẩm',
    status: 'active',
    waitingRoomEnabled: false,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: 8
  },
  'FLASH-101': {
    id: 'mock-meeting-flash-101',
    title: 'Weekly Flash Meeting',
    status: 'active',
    waitingRoomEnabled: true,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: 12
  },
  'DESIGN-204': {
    id: 'mock-meeting-design-204',
    title: 'Design review',
    status: 'active',
    waitingRoomEnabled: false,
    maxParticipants: 20,
    participantCount: 6
  },
  'ENDED-123': {
    id: 'mock-meeting-ended-123',
    title: 'Cuộc họp đã kết thúc',
    status: 'ended',
    waitingRoomEnabled: false,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: 10
  },
  'CANCEL-123': {
    id: 'mock-meeting-cancel-123',
    title: 'Cuộc họp đã hủy',
    status: 'cancelled',
    waitingRoomEnabled: false,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: 0
  },
  'LOCKED-123': {
    id: 'mock-meeting-locked-123',
    title: 'Cuộc họp đang khóa',
    status: 'locked',
    waitingRoomEnabled: false,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: 10
  },
  'FULL-123': {
    id: 'mock-meeting-full-123',
    title: 'Cuộc họp đã đủ người',
    status: 'active',
    waitingRoomEnabled: false,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: MAX_MEETING_PARTICIPANTS
  },
  'BLOCKED-123': {
    id: 'mock-meeting-blocked-123',
    title: 'Cuộc họp giới hạn người tham gia',
    status: 'active',
    waitingRoomEnabled: false,
    maxParticipants: MAX_MEETING_PARTICIPANTS,
    participantCount: 10
  }
});

function getJoinErrorScenario() {
  return String(new URLSearchParams(window.location.search).get('mock') ?? '').toLowerCase();
}

function getStoredCreatedMeeting(roomCode) {
  try {
    const storedMeeting = JSON.parse(sessionStorage.getItem('flashMeeting.createdMeeting') ?? 'null');
    return storedMeeting?.roomCode === roomCode ? storedMeeting : null;
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
      status: storedMeeting.status === 'scheduled' ? 'active' : storedMeeting.status,
      participantCount: Number(storedMeeting.participantCount ?? 0)
    };
  }

  const meeting = MOCK_JOIN_MEETINGS[roomCode];
  return meeting ? { roomCode, ...meeting } : null;
}

export async function resolveMeetingForJoin(input) {
  await wait(MOCK_DELAY);

  const scenario = getJoinErrorScenario();
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
  if (scenario === 'room-full' || scenario === 'full') {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.ROOM_FULL };
  }
  if (scenario === 'meeting-ended' || scenario === 'ended') {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_ENDED };
  }
  if (scenario === 'meeting-cancelled' || scenario === 'cancelled') {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_CANCELLED };
  }
  if (scenario === 'meeting-locked' || scenario === 'locked') {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_LOCKED };
  }
  if (scenario === 'user-blocked' || scenario === 'blocked') {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.USER_BLOCKED };
  }

  const roomCode = normalizeRoomCode(input?.roomCode);
  if (!isLikelyRoomCode(roomCode)) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.INVALID_ROOM_CODE };
  }

  const meeting = getJoinMeeting(roomCode);
  if (!meeting) return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_NOT_FOUND };
  if (scenario === 'waiting-room') meeting.waitingRoomEnabled = true;
  if (scenario === 'direct-join') meeting.waitingRoomEnabled = false;
  if (meeting.status === 'ended') return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_ENDED };
  if (meeting.status === 'cancelled') return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_CANCELLED };
  if (meeting.status === 'locked') return { success: false, code: JOIN_MEETING_ERROR_CODES.MEETING_LOCKED };
  if (roomCode === 'BLOCKED-123') return { success: false, code: JOIN_MEETING_ERROR_CODES.USER_BLOCKED };
  if (meeting.participantCount >= Number(meeting.maxParticipants ?? MAX_MEETING_PARTICIPANTS)) {
    return { success: false, code: JOIN_MEETING_ERROR_CODES.ROOM_FULL };
  }

  const displayName = String(input?.displayName ?? '').trim() || 'Khách tham gia';
  return {
    success: true,
    meeting,
    participant: { displayName }
  };
}

export const meetingService = Object.freeze({
  create: createMeeting,
  resolveForJoin: resolveMeetingForJoin
});
