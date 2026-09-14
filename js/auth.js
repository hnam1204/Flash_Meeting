import { AUTH_ERROR_CODES, authService } from './auth-service.js';
import { setStatus } from './utils.js';
import { renderIcons } from './ui/icons.js';

const AUTH_STATES = Object.freeze({
  INITIALIZING: 'initializing',
  READY: 'ready',
  REDIRECTING_TO_GOOGLE: 'redirecting-to-google',
  AUTHENTICATING: 'authenticating',
  SUCCESS: 'success',
  NON_GMAIL_ACCOUNT: 'non-gmail-account',
  OAUTH_ERROR: 'oauth-error',
  NETWORK_ERROR: 'network-error',
  SESSION_ERROR: 'session-error'
});

const page = document.body;
const status = document.querySelector('[data-form-status]');
const googleButton = document.querySelector('[data-google-login]');
const googleLabel = document.querySelector('[data-google-label]');
const authErrorDetail = document.querySelector('[data-auth-error-detail]');
const sessionExpiredNotice = document.querySelector('[data-session-expired-notice]');

renderIcons();

function wait(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function setAuthState(nextState) {
  page.dataset.authState = nextState;
}

function setStatusMessage(message, state = 'info') {
  setStatus(status, message, state);
}

function setControlsDisabled(disabled) {
  if (googleButton) googleButton.disabled = disabled;
}

function setErrorDetail(message = '') {
  if (!authErrorDetail) return;
  authErrorDetail.hidden = !message;
  authErrorDetail.textContent = message;
}

function showSessionExpiredNotice(show = true) {
  if (sessionExpiredNotice) sessionExpiredNotice.hidden = !show;
}

function getErrorCopy(code) {
  const copies = {
    [AUTH_ERROR_CODES.NON_GMAIL_ACCOUNT]: {
      message: 'FLASH MEETING hiện chỉ hỗ trợ tài khoản Gmail.',
      detail: 'Vui lòng đăng nhập bằng tài khoản có địa chỉ @gmail.com.',
      action: 'Thử tài khoản Google khác'
    },
    [AUTH_ERROR_CODES.AUTH_METHOD_NOT_ALLOWED]: {
      message: 'Vui lòng đăng nhập bằng tài khoản Google.',
      detail: 'FLASH MEETING chỉ sử dụng Google OAuth.',
      action: 'Thử lại với Google'
    },
    [AUTH_ERROR_CODES.NETWORK_ERROR]: {
      message: 'Không thể kết nối. Vui lòng thử lại.',
      detail: '',
      action: 'Thử lại với Google'
    },
    [AUTH_ERROR_CODES.CONFIGURATION_ERROR]: {
      message: 'Đăng nhập Google chưa sẵn sàng.',
      detail: 'Vui lòng thử lại sau hoặc liên hệ quản trị viên.',
      action: 'Thử lại với Google'
    },
    [AUTH_ERROR_CODES.GOOGLE_OAUTH_ERROR]: {
      message: 'Không thể đăng nhập bằng Google.',
      detail: '',
      action: 'Thử lại với Google'
    },
    [AUTH_ERROR_CODES.SESSION_ERROR]: {
      message: 'Không thể kiểm tra phiên đăng nhập.',
      detail: 'Vui lòng thử lại với tài khoản Google của bạn.',
      action: 'Thử lại với Google'
    }
  };
  return copies[code] || copies[AUTH_ERROR_CODES.GOOGLE_OAUTH_ERROR];
}

function showAuthError(code) {
  const copy = getErrorCopy(code);
  const errorState = code === AUTH_ERROR_CODES.NON_GMAIL_ACCOUNT
    ? AUTH_STATES.NON_GMAIL_ACCOUNT
    : code === AUTH_ERROR_CODES.NETWORK_ERROR
      ? AUTH_STATES.NETWORK_ERROR
      : code === AUTH_ERROR_CODES.SESSION_ERROR
        ? AUTH_STATES.SESSION_ERROR
        : AUTH_STATES.OAUTH_ERROR;

  setAuthState(errorState);
  setControlsDisabled(false);
  if (googleLabel) googleLabel.textContent = copy.action;
  setStatusMessage(copy.message, 'error');
  setErrorDetail(copy.detail);
}

function clearCallbackState() {
  authService.clearAuthCallbackParams();
}

async function redirectAfterLogin() {
  setAuthState(AUTH_STATES.SUCCESS);
  setStatusMessage('Đăng nhập thành công. Đang mở không gian của bạn…', 'success');
  await wait(360);
  setAuthState(AUTH_STATES.AUTHENTICATING);
  window.location.href = authService.consumeNextRoute();
}

async function initializeLogin() {
  setAuthState(AUTH_STATES.INITIALIZING);
  setControlsDisabled(true);
  authService.rememberNextRoute();
  showSessionExpiredNotice(new URLSearchParams(window.location.search).get('reason') === 'session_expired');
  const callbackError = authService.getOAuthCallbackError();
  if (callbackError) authService.clearOAuthLoginPending();
  const sessionResult = callbackError
    ? { success: false, code: callbackError, session: null }
    : await authService.bootstrapSession();
  clearCallbackState();

  if (!sessionResult.success) {
    if (sessionResult.code === AUTH_ERROR_CODES.SESSION_EXPIRED) {
      showSessionExpiredNotice();
      setControlsDisabled(false);
      setAuthState(AUTH_STATES.READY);
      setStatusMessage('');
      setErrorDetail('');
      return;
    }
    showAuthError(sessionResult.code);
    return;
  }

  if (sessionResult.session) {
    await redirectAfterLogin();
    return;
  }

  setControlsDisabled(false);
  setAuthState(AUTH_STATES.READY);
  setStatusMessage('');
  setErrorDetail('');
}

async function handleGoogleLogin() {
  if (![AUTH_STATES.READY, AUTH_STATES.OAUTH_ERROR, AUTH_STATES.NON_GMAIL_ACCOUNT, AUTH_STATES.NETWORK_ERROR, AUTH_STATES.SESSION_ERROR].includes(page.dataset.authState)) return;

  authService.rememberNextRoute();
  setAuthState(AUTH_STATES.REDIRECTING_TO_GOOGLE);
  setControlsDisabled(true);
  if (googleLabel) googleLabel.textContent = 'Đang chuyển đến Google…';
  setStatusMessage('Đang xử lý đăng nhập Google…');
  setErrorDetail('');

  const result = await authService.signInWithGoogle();
  if (!result.success) {
    showAuthError(result.code);
    return;
  }

  if (result.redirectUrl) window.location.assign(result.redirectUrl);
}

googleButton?.addEventListener('click', handleGoogleLogin);
initializeLogin();
