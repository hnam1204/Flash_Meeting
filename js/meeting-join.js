import { authService } from './auth-service.js';
import { JOIN_MEETING_ERROR_CODES, meetingService } from './meeting-service.js';
import { getPageUrl, isLikelyRoomCode, normalizeRoomCode, setStatus } from './utils.js';
import { modal } from './ui/modal-manager.js';
import { renderIcons } from './ui/icons.js';

const JOIN_STATES = Object.freeze({
  INITIALIZING: 'initializing',
  READY: 'ready',
  VALIDATING: 'validating',
  RESOLVING: 'resolving',
  SUCCESS: 'success',
  ERROR: 'error'
});

const DISPLAY_NAME_MIN_LENGTH = 2;
const DISPLAY_NAME_MAX_LENGTH = 50;
const REDIRECT_DELAY = 420;

const page = document.body;
const form = document.querySelector('[data-join-meeting-form]');
const status = document.querySelector('[data-form-status]');
const banner = document.querySelector('[data-join-banner]');
const roomCodeInput = form?.elements.roomCode;
const displayNameInput = form?.elements.displayName;
const submitButton = document.querySelector('[data-join-submit]');
const submitLabel = document.querySelector('[data-join-submit-label]');

renderIcons();

function wait(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function setJoinState(state) {
  page.dataset.joinState = state;
}

function setStatusMessage(message, state = 'info') {
  setStatus(status, message, state);
}

function setBanner(message, state = 'info') {
  if (!banner) return;
  banner.hidden = !message;
  banner.textContent = message;
  banner.dataset.state = state;
}

function setFormDisabled(disabled) {
  form?.querySelectorAll('input, button').forEach((control) => {
    control.disabled = disabled;
  });
}

function setFieldError(name, message = '') {
  const input = form?.elements[name];
  const error = form?.querySelector(`[data-field-error="${name}"]`);
  if (!input || !error) return;

  input.toggleAttribute('aria-invalid', Boolean(message));
  error.textContent = message;
}

function clearFieldErrors() {
  form?.querySelectorAll('[data-field-error]').forEach((error) => { error.textContent = ''; });
  form?.querySelectorAll('[aria-invalid="true"]').forEach((input) => input.removeAttribute('aria-invalid'));
}

function isOffline() {
  const scenario = new URLSearchParams(window.location.search).get('mock')?.toLowerCase();
  return scenario === 'offline' || navigator.onLine === false;
}

function updateOfflineState() {
  const offline = isOffline();
  if (offline) {
    setBanner('Bạn đang ngoại tuyến. Kết nối Internet để tham gia cuộc họp.', 'offline');
  } else if (banner?.dataset.state === 'offline') {
    setBanner('');
  }

  if ([JOIN_STATES.READY, JOIN_STATES.ERROR].includes(page.dataset.joinState)) {
    submitButton.disabled = offline;
  }
}

function validateForm() {
  clearFieldErrors();
  setStatusMessage('');

  const rawRoomCode = String(roomCodeInput?.value ?? '').trim();
  const roomCode = normalizeRoomCode(rawRoomCode);
  if (!rawRoomCode) {
    setFieldError('roomCode', 'Vui lòng nhập mã phòng.');
    roomCodeInput.focus();
    return { success: false };
  }
  if (!isLikelyRoomCode(roomCode)) {
    setFieldError('roomCode', 'Mã phòng không hợp lệ.');
    roomCodeInput.focus();
    return { success: false };
  }

  const rawDisplayName = String(displayNameInput?.value ?? '');
  const displayName = rawDisplayName.trim();
  if (rawDisplayName.length > 0 && !displayName) {
    setFieldError('displayName', 'Tên hiển thị không hợp lệ.');
    displayNameInput.focus();
    return { success: false };
  }
  if (displayName && (displayName.length < DISPLAY_NAME_MIN_LENGTH || displayName.length > DISPLAY_NAME_MAX_LENGTH)) {
    setFieldError('displayName', `Tên hiển thị phải có từ ${DISPLAY_NAME_MIN_LENGTH} đến ${DISPLAY_NAME_MAX_LENGTH} ký tự.`);
    displayNameInput.focus();
    return { success: false };
  }

  const session = authService.getSession();
  return {
    success: true,
    input: {
      roomCode,
      displayName: displayName || session?.displayName || 'Khách tham gia'
    }
  };
}

function getErrorMessage(code) {
  const messages = {
    [JOIN_MEETING_ERROR_CODES.AUTH_REQUIRED]: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.',
    [JOIN_MEETING_ERROR_CODES.INVALID_ROOM_CODE]: 'Mã phòng không hợp lệ.',
    [JOIN_MEETING_ERROR_CODES.MEETING_NOT_FOUND]: 'Không tìm thấy cuộc họp với mã phòng này.',
    [JOIN_MEETING_ERROR_CODES.MEETING_ENDED]: 'Cuộc họp này đã kết thúc.',
    [JOIN_MEETING_ERROR_CODES.MEETING_CANCELLED]: 'Cuộc họp này đã bị hủy.',
    [JOIN_MEETING_ERROR_CODES.MEETING_LOCKED]: 'Cuộc họp hiện đang bị khóa.',
    [JOIN_MEETING_ERROR_CODES.MEETING_NOT_STARTED]: 'Chủ phòng chưa bắt đầu cuộc họp. Vui lòng thử lại sau.',
    [JOIN_MEETING_ERROR_CODES.ROOM_FULL]: 'Cuộc họp đã đủ người tham gia.',
    [JOIN_MEETING_ERROR_CODES.USER_BLOCKED]: 'Bạn không thể tham gia cuộc họp này.',
    [JOIN_MEETING_ERROR_CODES.NETWORK_ERROR]: 'Không có kết nối Internet. Vui lòng thử lại.',
    [JOIN_MEETING_ERROR_CODES.RATE_LIMITED]: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',
    [JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE]: 'Dịch vụ tham gia cuộc họp tạm thời chưa sẵn sàng.',
    [JOIN_MEETING_ERROR_CODES.JOIN_FAILED]: 'Không thể tham gia cuộc họp lúc này. Vui lòng thử lại.'
  };
  return messages[code] ?? messages[JOIN_MEETING_ERROR_CODES.JOIN_FAILED];
}

function showError(code) {
  setJoinState(JOIN_STATES.ERROR);
  setFormDisabled(false);
  submitLabel.textContent = 'Tham gia cuộc họp';
  form.setAttribute('aria-busy', 'false');
  setStatusMessage(getErrorMessage(code), 'error');
  if (code === JOIN_MEETING_ERROR_CODES.NETWORK_ERROR && isOffline()) updateOfflineState();
}

function prefillFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const rawRoomCode = params.get('room');
  if (rawRoomCode) roomCodeInput.value = normalizeRoomCode(rawRoomCode);

  const session = authService.getSession();
  if (session?.displayName && !displayNameInput.value) displayNameInput.value = session.displayName;
}

function retryJoin() {
  if (page.dataset.joinState === JOIN_STATES.ERROR) setJoinState(JOIN_STATES.READY);
  form?.requestSubmit();
}

async function initializeJoinPage() {
  setJoinState(JOIN_STATES.INITIALIZING);
  setFormDisabled(true);
  form.setAttribute('aria-busy', 'true');
  prefillFromUrl();
  await wait(180);
  setFormDisabled(false);
  form.setAttribute('aria-busy', 'false');
  setJoinState(JOIN_STATES.READY);
  updateOfflineState();
}

async function handleSubmit(event) {
  event.preventDefault();
  if (page.dataset.joinState !== JOIN_STATES.READY || submitButton.disabled) return;

  setJoinState(JOIN_STATES.VALIDATING);
  const validation = validateForm();
  if (!validation.success) {
    setJoinState(JOIN_STATES.READY);
    return;
  }
  if (isOffline()) {
    showError(JOIN_MEETING_ERROR_CODES.NETWORK_ERROR);
    return;
  }

  setJoinState(JOIN_STATES.RESOLVING);
  setFormDisabled(true);
  form.setAttribute('aria-busy', 'true');
  submitLabel.textContent = 'Đang kiểm tra cuộc họp…';
  setStatusMessage('Đang tìm cuộc họp của bạn…');
  modal.processing({ title: 'Đang tham gia cuộc họp', message: 'Đang tìm cuộc họp của bạn.' });

  let result;
  try {
    result = await meetingService.resolveForJoin(validation.input);
  } catch {
    result = { success: false, code: JOIN_MEETING_ERROR_CODES.JOIN_FAILED };
  }
  if (!result.success) {
    showError(result.code);
    modal.error({
      title: 'Không thể tham gia cuộc họp',
      message: getErrorMessage(result.code),
      retryText: 'Thử lại',
      onRetry: retryJoin
    });
    return;
  }

  setJoinState(JOIN_STATES.SUCCESS);
  setStatusMessage('Đã tìm thấy cuộc họp. Đang mở Pre-Join…', 'success');
  sessionStorage.setItem('flashMeeting.roomCode', result.meeting.roomCode);
  sessionStorage.setItem('flashMeeting.displayName', result.participant.displayName);
  sessionStorage.setItem('flashMeeting.joinedMeeting', JSON.stringify(result.meeting));
  await wait(REDIRECT_DELAY);
  window.location.href = `${getPageUrl('prejoin.html')}?room=${encodeURIComponent(result.meeting.roomCode)}`;
}

function clearErrorOnInput() {
  form?.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => {
      setFieldError(input.name, '');
      if (page.dataset.joinState === JOIN_STATES.ERROR) {
        setJoinState(JOIN_STATES.READY);
        setStatusMessage('');
        updateOfflineState();
      }
    });
  });
}

window.addEventListener('offline', () => updateOfflineState());
window.addEventListener('online', () => updateOfflineState());
clearErrorOnInput();
form?.addEventListener('submit', handleSubmit);
initializeJoinPage();
