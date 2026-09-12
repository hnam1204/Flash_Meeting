import {
  JOIN_MEETING_ERROR_CODES,
  meetingService
} from './meeting-service.js';
import {
  getPageUrl,
  isLikelyRoomCode,
  normalizeRoomCode,
  readStoredRoomCode
} from './utils.js';

const WAITING_STATES = Object.freeze({
  INITIALIZING: 'initializing',
  WAITING: 'waiting',
  RECONNECTING: 'reconnecting',
  APPROVED: 'approved',
  JOINING: 'joining',
  REJECTED: 'rejected',
  ROOM_FULL: 'room_full',
  MEETING_ENDED: 'meeting_ended',
  MEETING_LOCKED: 'meeting_locked',
  REMOVED: 'removed',
  NETWORK_ERROR: 'network_error',
  SESSION_EXPIRED: 'session_expired',
  INVALID: 'invalid',
  LEAVING: 'leaving'
});

const STATUS_COPY = Object.freeze({
  initializing: { icon: '◷', kicker: 'Phòng chờ', title: 'Đang kiểm tra yêu cầu tham gia...', description: 'Đang khôi phục trạng thái yêu cầu của bạn.' },
  waiting: { icon: '◷', kicker: 'Phòng chờ', title: 'Đang chờ được chấp nhận', description: 'Chủ phòng đã nhận được yêu cầu tham gia của bạn.', line: 'Đang chờ' },
  reconnecting: { icon: '↻', kicker: 'Kết nối', title: 'Đang kết nối lại...', description: 'Yêu cầu tham gia của bạn vẫn được giữ lại.', line: 'Đang kết nối lại' },
  approved: { icon: '✓', kicker: 'Đã được chấp nhận', title: 'Bạn đã được chấp nhận', description: 'Đang vào cuộc họp...', line: 'Đã chấp nhận' },
  joining: { icon: '↗', kicker: 'Đang vào phòng', title: 'Đang vào cuộc họp...', description: 'Vui lòng chờ trong giây lát.', line: 'Đang mở phòng' },
  rejected: { icon: '!', kicker: 'Yêu cầu tham gia', title: 'Yêu cầu tham gia không được chấp nhận', description: 'Bạn hiện chưa thể tham gia cuộc họp này.' },
  room_full: { icon: '◎', kicker: 'Không thể tham gia', title: 'Cuộc họp đã đủ 50 người tham gia.', description: 'Phòng họp hiện không còn chỗ trống.' },
  meeting_ended: { icon: '■', kicker: 'Cuộc họp đã kết thúc', title: 'Cuộc họp đã kết thúc.', description: 'Bạn không thể tham gia cuộc họp này nữa.' },
  meeting_locked: { icon: '▣', kicker: 'Cuộc họp đang bị khóa', title: 'Cuộc họp hiện đang bị khóa.', description: 'Vui lòng liên hệ chủ phòng nếu bạn cần tham gia.' },
  removed: { icon: '×', kicker: 'Không thể tham gia', title: 'Bạn không thể tham gia cuộc họp này.', description: 'Phiên tham gia của bạn đã kết thúc.' },
  network_error: { icon: '⌁', kicker: 'Kết nối gặp vấn đề', title: 'Không có kết nối Internet.', description: 'Hãy kiểm tra kết nối rồi thử lại.' },
  session_expired: { icon: '↪', kicker: 'Phiên đăng nhập', title: 'Phiên đăng nhập đã hết hạn.', description: 'Vui lòng đăng nhập lại để tiếp tục.' },
  invalid: { icon: '!', kicker: 'Phòng chờ', title: 'Không thể mở phòng chờ.', description: 'Mã phòng không hợp lệ hoặc cuộc họp không tồn tại.' },
  leaving: { icon: '↩', kicker: 'Phòng chờ', title: 'Đang rời phòng chờ...', description: 'Đang lưu thay đổi của bạn.' }
});

const FINAL_STATES = new Set([
  WAITING_STATES.REJECTED,
  WAITING_STATES.ROOM_FULL,
  WAITING_STATES.MEETING_ENDED,
  WAITING_STATES.MEETING_LOCKED,
  WAITING_STATES.REMOVED
]);

const page = document.body;
const root = document.querySelector('[data-waiting-root]');
const statusRegion = document.querySelector('.waiting-card');
const context = document.querySelector('[data-meeting-context]');
const hostContext = document.querySelector('[data-host-context]');
const waitingActions = document.querySelector('[data-waiting-actions]');
const resultActions = document.querySelector('[data-result-actions]');
const checkDevicesLink = document.querySelector('[data-check-devices]');
const retryLink = document.querySelector('[data-retry]');
const loginLink = document.querySelector('[data-login-link]');
const leaveButton = document.querySelector('[data-leave-waiting]');

const state = {
  status: WAITING_STATES.INITIALIZING,
  roomCode: '',
  meeting: null,
  request: null,
  unsubscribe: null,
  joinTimer: 0,
  leaving: false
};

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = String(value ?? '');
}

function readStoredDisplayName() {
  try {
    return sessionStorage.getItem('flashMeeting.displayName')?.trim() || 'Khách tham gia';
  } catch {
    return 'Khách tham gia';
  }
}

function getRoomCode() {
  let storedRoomCode = '';
  try { storedRoomCode = readStoredRoomCode(); } catch { /* Session storage is optional in mock mode. */ }
  const rawRoomCode = new URLSearchParams(window.location.search).get('room') || storedRoomCode;
  const roomCode = normalizeRoomCode(rawRoomCode);
  return isLikelyRoomCode(roomCode) ? roomCode : '';
}

function getMockScenario() {
  return String(new URLSearchParams(window.location.search).get('mock') || '').toLowerCase();
}

function isOffline() {
  return navigator.onLine === false || ['offline', 'network-error'].includes(getMockScenario());
}

function setPrejoinLink() {
  if (!checkDevicesLink || !state.roomCode) return;
  const url = new URL(getPageUrl('prejoin.html'), window.location.href);
  url.searchParams.set('room', state.roomCode);
  url.searchParams.set('from', 'waiting');
  checkDevicesLink.href = url.href;
}

function setLoginLink() {
  if (!loginLink) return;
  const url = new URL(getPageUrl('login.html'), window.location.href);
  const next = new URL(getPageUrl('waiting-room.html'), window.location.href);
  if (state.roomCode) next.searchParams.set('room', state.roomCode);
  url.searchParams.set('next', `${next.pathname}${next.search}`);
  loginLink.href = url.href;
}

function renderMeetingContext() {
  if (!state.meeting) {
    context.hidden = true;
    return;
  }

  context.hidden = false;
  setText('[data-meeting-title]', state.meeting.title || 'Cuộc họp FLASH MEETING');
  setText('[data-room-code]', state.meeting.roomCode || state.roomCode);
  const hostName = String(state.meeting.hostName || state.request?.hostName || '').trim();
  hostContext.hidden = !hostName;
  if (hostName) setText('[data-host-name]', hostName);
}

function setActions(nextStatus) {
  const canWait = [WAITING_STATES.WAITING, WAITING_STATES.RECONNECTING].includes(nextStatus);
  const canShowResultActions = [
    ...FINAL_STATES,
    WAITING_STATES.NETWORK_ERROR,
    WAITING_STATES.SESSION_EXPIRED,
    WAITING_STATES.INVALID
  ].includes(nextStatus);

  waitingActions.hidden = !canWait;
  resultActions.hidden = !canShowResultActions;
  retryLink.hidden = nextStatus !== WAITING_STATES.NETWORK_ERROR;
  loginLink.hidden = nextStatus !== WAITING_STATES.SESSION_EXPIRED;
  leaveButton.disabled = nextStatus === WAITING_STATES.RECONNECTING ? false : nextStatus !== WAITING_STATES.WAITING;
  setPrejoinLink();
  setLoginLink();
}

function setState(nextStatus, note = '') {
  const copy = STATUS_COPY[nextStatus] || STATUS_COPY.invalid;
  state.status = nextStatus;
  page.dataset.waitingState = nextStatus;
  root.setAttribute('aria-busy', String([WAITING_STATES.INITIALIZING, WAITING_STATES.RECONNECTING, WAITING_STATES.JOINING, WAITING_STATES.LEAVING].includes(nextStatus)));
  statusRegion.setAttribute('aria-busy', String([WAITING_STATES.INITIALIZING, WAITING_STATES.RECONNECTING, WAITING_STATES.JOINING, WAITING_STATES.LEAVING].includes(nextStatus)));
  statusRegion.setAttribute('role', [WAITING_STATES.NETWORK_ERROR, WAITING_STATES.SESSION_EXPIRED, WAITING_STATES.INVALID].includes(nextStatus) ? 'alert' : 'status');
  setText('[data-status-icon]', copy.icon);
  setText('[data-status-kicker]', copy.kicker);
  setText('[data-status-title]', copy.title);
  setText('[data-status-description]', copy.description);
  const statusLine = document.querySelector('[data-status-line]');
  statusLine.hidden = !copy.line;
  if (copy.line) setText('[data-status-line-text]', copy.line);
  const noteElement = document.querySelector('[data-status-note]');
  noteElement.hidden = !note;
  if (note) noteElement.textContent = note;
  renderMeetingContext();
  setActions(nextStatus);
}

function mapErrorToState(code) {
  if (code === JOIN_MEETING_ERROR_CODES.AUTH_REQUIRED) return WAITING_STATES.SESSION_EXPIRED;
  if (code === JOIN_MEETING_ERROR_CODES.INVALID_ROOM_CODE || code === JOIN_MEETING_ERROR_CODES.MEETING_NOT_FOUND) return WAITING_STATES.INVALID;
  return WAITING_STATES.NETWORK_ERROR;
}

function clearWatcher() {
  state.unsubscribe?.();
  state.unsubscribe = null;
}

function clearJoinTimer() {
  window.clearTimeout(state.joinTimer);
  state.joinTimer = 0;
}

function navigateToMeeting() {
  const url = new URL(getPageUrl('meeting.html'), window.location.href);
  url.searchParams.set('room', state.roomCode);
  window.location.href = url.href;
}

function startJoining() {
  if (state.status === WAITING_STATES.JOINING || state.leaving) return;
  clearWatcher();
  clearJoinTimer();
  setState(WAITING_STATES.APPROVED);
  state.joinTimer = window.setTimeout(() => {
    setState(WAITING_STATES.JOINING);
    state.joinTimer = window.setTimeout(navigateToMeeting, 420);
  }, 520);
}

function handleRequestChange(nextRequest) {
  state.request = { ...state.request, ...nextRequest };
  if (nextRequest.status === 'approved') {
    startJoining();
    return;
  }
  if (FINAL_STATES.has(nextRequest.status)) {
    clearWatcher();
    setState(nextRequest.status);
    return;
  }
  setState(WAITING_STATES.WAITING);
}

function watchRequest(nextStatus = WAITING_STATES.WAITING) {
  clearWatcher();
  state.unsubscribe = meetingService.watchWaitingRequest({
    roomCode: state.roomCode,
    status: nextStatus,
    onChange: handleRequestChange,
    onError: (error) => {
      clearWatcher();
      setState(mapErrorToState(error?.code), 'Bạn có thể thử lại khi kết nối ổn định hơn.');
    }
  });
}

function handleRetry(event) {
  event.preventDefault();
  if (state.status === WAITING_STATES.JOINING || state.leaving) return;
  initialize();
}

function handleOffline() {
  if ([WAITING_STATES.WAITING, WAITING_STATES.RECONNECTING].includes(state.status)) {
    clearWatcher();
    setState(WAITING_STATES.NETWORK_ERROR, 'Yêu cầu tham gia chưa bị hủy. Hãy thử lại khi đã trực tuyến.');
  }
}

function handleOnline() {
  if (state.status === WAITING_STATES.NETWORK_ERROR && getMockScenario() !== 'network-error') initialize();
}

function handleLeave() {
  if (state.leaving) return;
  state.leaving = true;
  clearWatcher();
  clearJoinTimer();
  setState(WAITING_STATES.LEAVING);
  meetingService.withdrawWaitingRequest({ roomCode: state.roomCode });
  try {
    sessionStorage.removeItem('flashMeeting.roomCode');
    sessionStorage.removeItem('flashMeeting.joinedMeeting');
  } catch {
    // Session storage is optional in mock mode.
  }
  window.setTimeout(() => { window.location.href = getPageUrl('index.html'); }, 180);
}

async function initialize() {
  clearWatcher();
  clearJoinTimer();
  state.roomCode = getRoomCode();
  state.meeting = null;
  state.request = null;
  state.leaving = false;
  setState(WAITING_STATES.INITIALIZING);

  if (!state.roomCode || isOffline()) {
    setState(isOffline() ? WAITING_STATES.NETWORK_ERROR : WAITING_STATES.INVALID);
    return;
  }

  const result = await meetingService.getWaitingRoom({
    roomCode: state.roomCode,
    displayName: readStoredDisplayName()
  });
  if (!result.success) {
    setState(mapErrorToState(result.code));
    return;
  }

  state.meeting = result.meeting;
  state.request = result.request;
  renderMeetingContext();

  if (result.request.status === 'approved') {
    startJoining();
    return;
  }
  if (FINAL_STATES.has(result.request.status)) {
    setState(result.request.status);
    return;
  }

  if (getMockScenario() === 'reconnecting') {
    setState(WAITING_STATES.RECONNECTING);
    watchRequest(WAITING_STATES.RECONNECTING);
    return;
  }

  setState(WAITING_STATES.WAITING);
  watchRequest(WAITING_STATES.WAITING);
}

retryLink?.addEventListener('click', handleRetry);
leaveButton?.addEventListener('click', handleLeave);
window.addEventListener('offline', handleOffline);
window.addEventListener('online', handleOnline);
window.addEventListener('pagehide', clearWatcher, { once: true });

// TODO Realtime Phase: replace the mock waiting-request subscription with Supabase Realtime after backend authorization is implemented.
initialize();
