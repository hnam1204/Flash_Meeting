export const ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  MEETING_NOT_FOUND: 'MEETING_NOT_FOUND',
  MEETING_ENDED: 'MEETING_ENDED',
  MEETING_LOCKED: 'MEETING_LOCKED',
  ROOM_FULL: 'ROOM_FULL',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  FOUNDATION_NOT_READY: 'FOUNDATION_NOT_READY'
});

export function getPageUrl(page) {
  const basePath = import.meta.env.BASE_URL ?? '/';
  return `${basePath.replace(/\/$/, '/')}${page.replace(/^\//, '')}`;
}

export function setStatus(element, message, state = 'info') {
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}

export function normalizeRoomCode(value) {
  const input = String(value ?? '').trim();
  if (!input) return '';

  try {
    const parsedUrl = new URL(input, globalThis.location?.href || 'http://localhost/');
    const queryRoomCode = parsedUrl.searchParams.get('room');
    const fromPath = parsedUrl.pathname.split('/').filter(Boolean).pop();
    return String(queryRoomCode || fromPath || '').replace(/[^a-z0-9-]/gi, '').toUpperCase();
  } catch {
    return input.replace(/[^a-z0-9-]/gi, '').toUpperCase();
  }
}

export function isLikelyRoomCode(value) {
  return /^[A-Z0-9]{3,}(?:-[A-Z0-9]{2,})*$/.test(normalizeRoomCode(value));
}

export function getMeetingInviteUrl(roomCode) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!isLikelyRoomCode(normalizedRoomCode)) return '';

  const inviteUrl = new URL(getPageUrl('join-meeting.html'), window.location.href);
  inviteUrl.searchParams.set('room', normalizedRoomCode);
  return inviteUrl.href;
}

export function readStoredRoomCode() {
  return sessionStorage.getItem('flashMeeting.roomCode') ?? '';
}
