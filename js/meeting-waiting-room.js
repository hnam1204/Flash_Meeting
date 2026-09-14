import {
  JOIN_MEETING_ERROR_CODES,
  MAX_MEETING_PARTICIPANTS,
  meetingService
} from './meeting-service.js';
import {
  getPageUrl,
  isLikelyRoomCode,
  normalizeRoomCode,
  readStoredRoomCode
} from './utils.js';
import { protectPage, registerAuthExpiryCleanup } from './auth-guard.js';
import { modal } from './ui/modal-manager.js';
import { renderIcons, setIcon } from './ui/icons.js';

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

const STATE_CONFIG = Object.freeze({
  initializing: { icon: 'loader-circle', kicker: 'Phòng chờ', title: 'Đang tải phòng chờ...', description: 'Đang khôi phục trạng thái yêu cầu của bạn.', actions: [] },
  waiting: { icon: 'clock-3', kicker: 'Phòng chờ', title: 'Đang chờ được chấp nhận', description: 'Chủ phòng đã nhận được yêu cầu tham gia của bạn.', line: 'Đang chờ', actions: ['devices', 'leave'] },
  reconnecting: { icon: 'loader-circle', kicker: 'Kết nối', title: 'Đang kết nối lại...', description: 'Hệ thống đang khôi phục kết nối.', line: 'Đang kết nối lại', actions: ['leave'] },
  approved: { icon: 'circle-check', kicker: 'Đã được chấp nhận', title: 'Đã được chấp nhận', description: 'Đang vào cuộc họp...', line: 'Đã chấp nhận', actions: [] },
  joining: { icon: 'log-in', kicker: 'Đang vào phòng', title: 'Đang vào cuộc họp...', description: 'Vui lòng chờ trong giây lát.', line: 'Đang mở phòng', actions: [] },
  rejected: { icon: 'circle-x', kicker: 'Yêu cầu tham gia', title: 'Yêu cầu tham gia chưa được chấp nhận', description: 'Bạn chưa thể tham gia cuộc họp này.', actions: ['home', 'joinAnother'] },
  room_full: { icon: 'users', kicker: 'Không thể tham gia', title: 'Cuộc họp đã đủ người', description: `Cuộc họp hiện đã đạt giới hạn ${MAX_MEETING_PARTICIPANTS} người tham gia.`, actions: ['home', 'joinAnother'] },
  meeting_ended: { icon: 'circle-stop', kicker: 'Cuộc họp đã kết thúc', title: 'Cuộc họp đã kết thúc', description: 'Cuộc họp này không còn hoạt động.', actions: ['home', 'joinAnother'] },
  meeting_locked: { icon: 'lock-keyhole', kicker: 'Cuộc họp đang bị khóa', title: 'Cuộc họp hiện đang bị khóa.', description: 'Vui lòng liên hệ chủ phòng nếu bạn cần tham gia.', actions: ['home'] },
  removed: { icon: 'user-round-x', kicker: 'Không thể tham gia', title: 'Bạn không thể tham gia cuộc họp này.', description: 'Phiên tham gia của bạn đã kết thúc.', actions: ['home'] },
  network_error: { icon: 'signal', kicker: 'Kết nối gặp vấn đề', title: 'Không thể kết nối', description: 'Không thể duy trì kết nối với phòng chờ.', actions: ['retry', 'leave'] },
  session_expired: { icon: 'log-in', kicker: 'Phiên đăng nhập', title: 'Phiên đăng nhập đã hết hạn', description: 'Vui lòng đăng nhập lại để tiếp tục.', actions: ['login'] },
  invalid: { icon: 'circle-alert', kicker: 'Phòng chờ', title: 'Không thể mở phòng chờ.', description: 'Mã phòng không hợp lệ hoặc cuộc họp không tồn tại.', actions: ['home'] },
  leaving: { icon: 'log-out', kicker: 'Phòng chờ', title: 'Đang rời phòng chờ...', description: 'Đang lưu thay đổi của bạn.', actions: [] }
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
const stateActions = document.querySelector('[data-state-actions]');
const checkDevicesLink = document.querySelector('[data-check-devices]');
const retryLink = document.querySelector('[data-retry]');
const homeLink = document.querySelector('[data-home-link]');
const joinAnotherLink = document.querySelector('[data-join-another-link]');
const loginLink = document.querySelector('[data-login-link]');
const leaveButton = document.querySelector('[data-leave-waiting]');

renderIcons();

const state = {
  status: WAITING_STATES.INITIALIZING,
  roomCode: '',
  meeting: null,
  participantContext: null,
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

function setJoinAnotherLink() {
  if (joinAnotherLink) joinAnotherLink.href = getPageUrl('join-meeting.html');
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
  const actions = new Set(STATE_CONFIG[nextStatus]?.actions || []);
  stateActions.hidden = actions.size === 0;
  checkDevicesLink.hidden = !actions.has('devices');
  leaveButton.hidden = !actions.has('leave');
  retryLink.hidden = !actions.has('retry');
  homeLink.hidden = !actions.has('home');
  joinAnotherLink.hidden = !actions.has('joinAnother');
  loginLink.hidden = !actions.has('login');
  leaveButton.disabled = !actions.has('leave');
  setPrejoinLink();
  setLoginLink();
  setJoinAnotherLink();
}

function setState(nextStatus, note = '') {
  const previousStatus = state.status;
  const copy = STATE_CONFIG[nextStatus] || STATE_CONFIG[WAITING_STATES.INVALID];
  state.status = nextStatus;
  page.dataset.waitingState = nextStatus;
  root.setAttribute('aria-busy', String([WAITING_STATES.INITIALIZING, WAITING_STATES.RECONNECTING, WAITING_STATES.JOINING, WAITING_STATES.LEAVING].includes(nextStatus)));
  statusRegion.setAttribute('aria-busy', String([WAITING_STATES.INITIALIZING, WAITING_STATES.RECONNECTING, WAITING_STATES.JOINING, WAITING_STATES.LEAVING].includes(nextStatus)));
  statusRegion.setAttribute('role', [WAITING_STATES.NETWORK_ERROR, WAITING_STATES.SESSION_EXPIRED, WAITING_STATES.INVALID].includes(nextStatus) ? 'alert' : 'status');
  setIcon(document.querySelector('[data-status-icon]'), copy.icon);
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

  const needsAnnouncement = [
    WAITING_STATES.REJECTED,
    WAITING_STATES.ROOM_FULL,
    WAITING_STATES.MEETING_ENDED,
    WAITING_STATES.MEETING_LOCKED,
    WAITING_STATES.REMOVED,
    WAITING_STATES.NETWORK_ERROR,
    WAITING_STATES.SESSION_EXPIRED,
    WAITING_STATES.INVALID
  ].includes(nextStatus);
  if (previousStatus !== nextStatus && needsAnnouncement) {
    window.requestAnimationFrame(() => statusRegion.focus({ preventScroll: true }));
  }
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

async function handleLeave() {
  if (state.leaving) return;
  const confirmed = await modal.confirm({
    title: 'Rời phòng chờ?',
    message: 'Yêu cầu tham gia của bạn sẽ được hủy.',
    confirmText: 'Rời phòng chờ',
    cancelText: 'Ở lại'
  });
  if (!confirmed || state.leaving) return;

  state.leaving = true;
  clearWatcher();
  clearJoinTimer();
  setState(WAITING_STATES.LEAVING);
  modal.processing({ title: 'Đang rời phòng chờ', message: 'Vui lòng chờ trong giây lát.' });
  let result;
  try {
    result = await meetingService.withdrawWaitingRequest({ roomCode: state.roomCode });
  } catch {
    result = { success: false };
  }
  if (!result?.success) {
    state.leaving = false;
    setState(WAITING_STATES.WAITING);
    modal.error({
      title: 'Không thể rời phòng chờ',
      message: 'Vui lòng thử lại.',
      retryText: 'Thử lại',
      onRetry: () => { void handleLeave(); }
    });
    return;
  }
  try {
    sessionStorage.removeItem('flashMeeting.roomCode');
    sessionStorage.removeItem('flashMeeting.joinedMeeting');
    sessionStorage.removeItem('flashMeeting.joinedParticipant');
  } catch {
    // Session storage is optional in mock mode.
  }
  modal.success({ title: 'Đã rời phòng chờ', message: 'Yêu cầu tham gia đã được hủy.', autoCloseMs: 500 });
  window.setTimeout(() => { window.location.href = getPageUrl('join-meeting.html'); }, 560);
}

async function initialize() {
  clearWatcher();
  clearJoinTimer();
  state.roomCode = getRoomCode();
  state.meeting = null;
  state.request = null;
  state.participantContext = null;
  state.leaving = false;
  setState(WAITING_STATES.INITIALIZING);

  const sessionResult = await protectPage();
  if (!sessionResult.success || !sessionResult.session) return;

  if (!state.roomCode || isOffline()) {
    setState(isOffline() ? WAITING_STATES.NETWORK_ERROR : WAITING_STATES.INVALID);
    return;
  }

  let result;
  try {
    result = await meetingService.getWaitingRoom({
      roomCode: state.roomCode,
      displayName: readStoredDisplayName()
    });
  } catch {
    setState(WAITING_STATES.NETWORK_ERROR, 'Bạn có thể thử lại khi kết nối ổn định hơn.');
    modal.error({
      title: 'Không thể mở phòng chờ',
      message: 'Vui lòng thử lại.',
      retryText: 'Thử lại',
      onRetry: () => { void initialize(); }
    });
    return;
  }
  if (!result.success) {
    setState(mapErrorToState(result.code));
    return;
  }

  state.meeting = result.meeting;
  state.request = result.request;
  state.participantContext = result.participantContext;

  if (state.participantContext?.isHost || state.participantContext?.isCoHost) {
    navigateToMeeting();
    return;
  }

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

// Production waiting requests use secure membership updates; mock scenarios keep the local watcher.
registerAuthExpiryCleanup(() => {
  clearWatcher();
  clearJoinTimer();
  if (!state.leaving) setState(WAITING_STATES.SESSION_EXPIRED);
});
initialize();
