import {
  CREATE_MEETING_ERROR_CODES,
  MEETING_TITLE_MAX_LENGTH,
  SUPPORTED_ACCESS_MODE,
  meetingService
} from './meeting-service.js';
import { getPageUrl, setStatus } from './utils.js';
import { protectPage } from './auth-guard.js';
import { modal } from './ui/modal-manager.js';
import { renderIcons } from './ui/icons.js';

const CREATE_STATES = Object.freeze({
  INITIALIZING: 'initializing',
  READY: 'ready',
  VALIDATING: 'validating',
  CREATING: 'creating',
  SUCCESS: 'success',
  ERROR: 'error'
});

const page = document.body;
const form = document.querySelector('[data-create-meeting-form]');
const status = document.querySelector('[data-form-status]');
const banner = document.querySelector('[data-create-banner]');
const submitButton = document.querySelector('[data-create-submit]');
const submitLabel = document.querySelector('[data-create-submit-label]');
const profileAvatar = document.querySelector('[data-create-profile-avatar]');

renderIcons();

function wait(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function setCreateState(state) {
  page.dataset.createState = state;
}

function renderProfileAvatar(user) {
  if (!profileAvatar) return;
  const words = String(user?.displayName || '').trim().split(/\s+/).filter(Boolean);
  profileAvatar.textContent = words.map((word) => word[0]).slice(-2).join('').toUpperCase() || 'FM';
}

function setStatusMessage(message, state = 'info') {
  setStatus(status, message, state);
}

function setBanner(message, type = 'info') {
  if (!banner) return;
  banner.hidden = !message;
  banner.textContent = message;
  banner.dataset.state = type;
}

function setFormDisabled(disabled) {
  form?.querySelectorAll('input, select, button').forEach((control) => {
    control.disabled = disabled;
  });
}

function setOfflineState(isOffline) {
  if (isOffline) {
    setBanner('Bạn đang ngoại tuyến. Kết nối Internet để tạo cuộc họp.', 'offline');
  } else if (banner?.dataset.state === 'offline') {
    setBanner('');
  }
  if ([CREATE_STATES.READY, CREATE_STATES.ERROR].includes(page.dataset.createState)) {
    submitButton.disabled = isOffline;
  }
}

function isOffline() {
  return navigator.onLine === false;
}

function getErrorMessage(code) {
  const messages = {
    [CREATE_MEETING_ERROR_CODES.AUTH_REQUIRED]: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    [CREATE_MEETING_ERROR_CODES.INVALID_DISPLAY_NAME]: 'Vui lòng nhập tên hiển thị hợp lệ trước khi tạo cuộc họp.',
    [CREATE_MEETING_ERROR_CODES.INVALID_TITLE]: `Tiêu đề không được chỉ chứa khoảng trắng và không quá ${MEETING_TITLE_MAX_LENGTH} ký tự.`,
    [CREATE_MEETING_ERROR_CODES.RATE_LIMITED]: 'Bạn đang tạo cuộc họp quá nhanh. Vui lòng thử lại sau.',
    [CREATE_MEETING_ERROR_CODES.NETWORK_ERROR]: 'Không có kết nối Internet. Vui lòng thử lại khi mạng ổn định.',
    [CREATE_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE]: 'Dịch vụ tạo cuộc họp tạm thời chưa sẵn sàng.',
    [CREATE_MEETING_ERROR_CODES.CREATE_MEETING_FAILED]: 'Không thể tạo cuộc họp lúc này. Vui lòng thử lại.'
  };
  return messages[code] ?? messages[CREATE_MEETING_ERROR_CODES.CREATE_MEETING_FAILED];
}

function showError(code) {
  setCreateState(CREATE_STATES.ERROR);
  setFormDisabled(false);
  submitLabel.textContent = 'Tạo cuộc họp';
  form.setAttribute('aria-busy', 'false');
  setStatusMessage(getErrorMessage(code), 'error');
  if (code === CREATE_MEETING_ERROR_CODES.NETWORK_ERROR && isOffline()) setOfflineState(true);

  window.setTimeout(() => {
    if (page.dataset.createState === CREATE_STATES.ERROR) setCreateState(CREATE_STATES.READY);
  }, 1200);
}

function validateForm() {
  const rawTitle = String(form.elements.title.value ?? '');
  const title = rawTitle.trim();
  const accessMode = String(form.elements.accessMode.value ?? '');

  if ((rawTitle.length > 0 && !title) || title.length > MEETING_TITLE_MAX_LENGTH) {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.INVALID_TITLE };
  }
  if (accessMode !== SUPPORTED_ACCESS_MODE) {
    return { success: false, code: CREATE_MEETING_ERROR_CODES.CREATE_MEETING_FAILED };
  }

  return {
    success: true,
    input: {
      title,
      accessMode
    }
  };
}

function retryCreate() {
  if (page.dataset.createState === CREATE_STATES.ERROR) setCreateState(CREATE_STATES.READY);
  form?.requestSubmit();
}

async function initializeCreatePage() {
  setCreateState(CREATE_STATES.INITIALIZING);
  setFormDisabled(true);
  form.setAttribute('aria-busy', 'true');
  await wait(300);

  const sessionResult = await protectPage();
  if (!sessionResult.success || !sessionResult.session) return;
  renderProfileAvatar(sessionResult.user);

  setFormDisabled(false);
  form.setAttribute('aria-busy', 'false');
  setCreateState(CREATE_STATES.READY);
  setOfflineState(isOffline());
}

async function handleSubmit(event) {
  event.preventDefault();
  if (page.dataset.createState !== CREATE_STATES.READY || submitButton.disabled) return;

  setCreateState(CREATE_STATES.VALIDATING);
  setStatusMessage('Đang kiểm tra thông tin phòng họp…');
  const validation = validateForm();
  if (!validation.success) {
    showError(validation.code);
    return;
  }

  setCreateState(CREATE_STATES.CREATING);
  setFormDisabled(true);
  form.setAttribute('aria-busy', 'true');
  submitLabel.textContent = 'Đang tạo cuộc họp…';
  setStatusMessage('Đang chuẩn bị phòng họp của bạn…');
  modal.processing({ title: 'Đang tạo cuộc họp', message: 'Đang chuẩn bị phòng họp của bạn.' });

  let result;
  try {
    result = await meetingService.create(validation.input);
  } catch {
    result = { success: false, code: CREATE_MEETING_ERROR_CODES.CREATE_MEETING_FAILED };
  }
  if (!result.success) {
    showError(result.code);
    modal.error({
      title: 'Không thể tạo cuộc họp',
      message: getErrorMessage(result.code),
      retryText: 'Thử lại',
      onRetry: retryCreate
    });
    return;
  }

  setCreateState(CREATE_STATES.SUCCESS);
  setStatusMessage('Tạo cuộc họp thành công. Đang mở Pre-Join…', 'success');
  sessionStorage.setItem('flashMeeting.roomCode', result.meeting.roomCode);
  sessionStorage.setItem('flashMeeting.createdMeeting', JSON.stringify(result.meeting));
  window.setTimeout(() => {
    window.location.href = `${getPageUrl('prejoin.html')}?room=${encodeURIComponent(result.meeting.roomCode)}`;
  }, 350);
}

form?.querySelectorAll('input, select').forEach((control) => {
  control.addEventListener('input', () => {
    if (page.dataset.createState === CREATE_STATES.ERROR) {
      setCreateState(CREATE_STATES.READY);
      setStatusMessage('');
      setOfflineState(isOffline());
    }
  });
  control.addEventListener('change', () => {
    if (page.dataset.createState === CREATE_STATES.ERROR) {
      setCreateState(CREATE_STATES.READY);
      setStatusMessage('');
      setOfflineState(isOffline());
    }
  });
});

window.addEventListener('offline', () => setOfflineState(true));
window.addEventListener('online', () => setOfflineState(false));
form?.addEventListener('submit', handleSubmit);

initializeCreatePage();
