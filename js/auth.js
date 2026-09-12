import { getPageUrl, setStatus } from './utils.js';
import { AUTH_ERROR_CODES, authService } from './auth-service.js';

const AUTH_STATES = Object.freeze({
  INITIALIZING: 'initializing',
  READY: 'ready',
  SUBMITTING: 'submitting',
  GOOGLE_LOADING: 'google-loading',
  SUCCESS: 'success',
  ERROR: 'error',
  NETWORK_ERROR: 'network-error',
  RATE_LIMITED: 'rate-limited',
  UNVERIFIED_EMAIL: 'unverified-email',
  REDIRECTING: 'redirecting'
});

const REDIRECT_DELAY = 650;
const DISPLAY_NAME_MIN_LENGTH = 2;
const DISPLAY_NAME_MAX_LENGTH = 50;

const page = document.body;
const mode = page.dataset.authMode;
const form = document.querySelector('[data-auth-form]');
const status = document.querySelector('[data-form-status]');
const loadingMessage = document.querySelector('[data-auth-loading]');
const submitButton = form?.querySelector('button[type="submit"]');
const submitLabel = form?.querySelector('[data-submit-label]');
const googleButton = document.querySelector('[data-google-login]');
const googleLabel = document.querySelector('[data-google-label]');

function setAuthState(state) {
  page.dataset.authState = state;
}

function wait(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function setStatusMessage(message, state = 'info') {
  setStatus(status, message, state);
}

function setControlsDisabled(disabled) {
  form?.querySelectorAll('input, button').forEach((control) => {
    control.disabled = disabled;
  });
  if (googleButton) googleButton.disabled = disabled;
}

function getFieldError(name) {
  return form?.querySelector(`[data-field-error="${name}"]`);
}

function setFieldError(name, message = '') {
  const input = form?.elements[name];
  const error = getFieldError(name);
  if (!input || !error) return;

  input.toggleAttribute('aria-invalid', Boolean(message));
  error.textContent = message;
}

function clearFieldErrors() {
  form?.querySelectorAll('[data-field-error]').forEach((error) => { error.textContent = ''; });
  form?.querySelectorAll('[aria-invalid="true"]').forEach((input) => input.removeAttribute('aria-invalid'));
}

function validateEmail(name = 'email') {
  const input = form.elements[name];
  const value = String(input.value ?? '').trim();
  if (!value) return { valid: false, message: 'Vui lòng nhập email.' };
  if (!input.validity.valid) return { valid: false, message: 'Email không hợp lệ.' };
  return { valid: true, value };
}

function validateLogin() {
  clearFieldErrors();
  setStatusMessage('');

  const email = validateEmail();
  if (!email.valid) {
    setFieldError('email', email.message);
    form.elements.email.focus();
    return false;
  }

  const password = String(form.elements.password.value ?? '');
  if (!password) {
    setFieldError('password', 'Vui lòng nhập mật khẩu.');
    form.elements.password.focus();
    return false;
  }
  if (password.length < 8) {
    setFieldError('password', 'Mật khẩu phải có ít nhất 8 ký tự.');
    form.elements.password.focus();
    return false;
  }

  return true;
}

function validateRegister() {
  clearFieldErrors();
  setStatusMessage('');

  const displayName = String(form.elements.displayName.value ?? '').trim();
  if (!displayName) {
    setFieldError('displayName', 'Vui lòng nhập tên hiển thị.');
    form.elements.displayName.focus();
    return false;
  }
  if (displayName.length < DISPLAY_NAME_MIN_LENGTH || displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    setFieldError('displayName', `Tên hiển thị phải có từ ${DISPLAY_NAME_MIN_LENGTH} đến ${DISPLAY_NAME_MAX_LENGTH} ký tự.`);
    form.elements.displayName.focus();
    return false;
  }

  const email = validateEmail();
  if (!email.valid) {
    setFieldError('email', email.message);
    form.elements.email.focus();
    return false;
  }

  const password = String(form.elements.password.value ?? '');
  if (!password) {
    setFieldError('password', 'Vui lòng nhập mật khẩu.');
    form.elements.password.focus();
    return false;
  }
  if (password.length < 8) {
    setFieldError('password', 'Mật khẩu phải có ít nhất 8 ký tự.');
    form.elements.password.focus();
    return false;
  }

  const confirmPassword = String(form.elements.confirmPassword.value ?? '');
  if (!confirmPassword || confirmPassword !== password) {
    setFieldError('confirmPassword', 'Mật khẩu xác nhận không khớp.');
    form.elements.confirmPassword.focus();
    return false;
  }

  return true;
}

function getErrorMessage(code) {
  const messages = {
    [AUTH_ERROR_CODES.INVALID_CREDENTIALS]: 'Email hoặc mật khẩu không chính xác.',
    [AUTH_ERROR_CODES.NETWORK_ERROR]: 'Không thể kết nối. Vui lòng thử lại.',
    [AUTH_ERROR_CODES.RATE_LIMITED]: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',
    [AUTH_ERROR_CODES.UNVERIFIED_EMAIL]: 'Vui lòng xác minh email trước khi đăng nhập.',
    [AUTH_ERROR_CODES.REGISTER_FAILED]: 'Không thể tạo tài khoản lúc này. Vui lòng thử lại.'
  };
  return messages[code] ?? 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}

function getErrorState(code) {
  const states = {
    [AUTH_ERROR_CODES.INVALID_CREDENTIALS]: AUTH_STATES.ERROR,
    [AUTH_ERROR_CODES.NETWORK_ERROR]: AUTH_STATES.NETWORK_ERROR,
    [AUTH_ERROR_CODES.RATE_LIMITED]: AUTH_STATES.RATE_LIMITED,
    [AUTH_ERROR_CODES.UNVERIFIED_EMAIL]: AUTH_STATES.UNVERIFIED_EMAIL,
    [AUTH_ERROR_CODES.REGISTER_FAILED]: AUTH_STATES.ERROR
  };
  return states[code] ?? AUTH_STATES.ERROR;
}

function returnToReady() {
  window.setTimeout(() => {
    if ([AUTH_STATES.ERROR, AUTH_STATES.NETWORK_ERROR, AUTH_STATES.RATE_LIMITED, AUTH_STATES.UNVERIFIED_EMAIL]
      .includes(page.dataset.authState)) {
      setAuthState(AUTH_STATES.READY);
    }
  }, 1400);
}

function showAuthError(code) {
  setAuthState(getErrorState(code));
  setControlsDisabled(false);
  if (submitButton) submitButton.disabled = false;
  if (submitLabel) submitLabel.textContent = mode === 'register' ? 'Tạo tài khoản' : 'Đăng nhập';
  form?.setAttribute('aria-busy', 'false');
  setStatusMessage(getErrorMessage(code), 'error');
  returnToReady();
}

async function redirectAfterLogin(message) {
  setAuthState(AUTH_STATES.SUCCESS);
  setStatusMessage(message, 'success');
  await wait(REDIRECT_DELAY);
  setAuthState(AUTH_STATES.REDIRECTING);
  window.location.href = authService.getSafeNextUrl();
}

async function initializeLogin() {
  setAuthState(AUTH_STATES.INITIALIZING);
  setControlsDisabled(true);
  form?.setAttribute('aria-busy', 'true');
  if (loadingMessage) loadingMessage.querySelector('span:last-child').textContent = 'Đang kiểm tra phiên đăng nhập…';
  await wait(320);

  if (authService.getSession()) {
    setAuthState(AUTH_STATES.REDIRECTING);
    if (loadingMessage) loadingMessage.querySelector('span:last-child').textContent = 'Đang chuyển hướng…';
    await wait(260);
    window.location.href = authService.getSafeNextUrl();
    return;
  }

  form?.setAttribute('aria-busy', 'false');
  setControlsDisabled(false);
  setAuthState(AUTH_STATES.READY);
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  if (page.dataset.authState !== AUTH_STATES.READY || !validateLogin()) return;

  setAuthState(AUTH_STATES.SUBMITTING);
  setControlsDisabled(true);
  form.setAttribute('aria-busy', 'true');
  submitLabel.textContent = 'Đang đăng nhập…';
  setStatusMessage('Đang kiểm tra thông tin…');

  const result = await authService.signInWithEmail({
    email: form.elements.email.value,
    password: form.elements.password.value,
    remember: true
  });

  if (!result.success) {
    showAuthError(result.code);
    form.elements.password.focus();
    return;
  }

  await redirectAfterLogin('Đăng nhập thành công. Đang mở không gian của bạn…');
}

async function handleGoogleLogin() {
  if (page.dataset.authState !== AUTH_STATES.READY) return;

  setAuthState(AUTH_STATES.GOOGLE_LOADING);
  setControlsDisabled(true);
  form?.setAttribute('aria-busy', 'true');
  googleLabel.textContent = 'Đang kết nối Google…';
  setStatusMessage('Đang xử lý đăng nhập…');

  const result = await authService.signInWithGoogle({ remember: true });
  if (!result.success) {
    googleLabel.textContent = 'Tiếp tục với Google';
    showAuthError(result.code);
    return;
  }

  await redirectAfterLogin('Đăng nhập thành công. Đang mở không gian của bạn…');
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  if (page.dataset.authState !== AUTH_STATES.READY || !validateRegister()) return;

  setAuthState(AUTH_STATES.SUBMITTING);
  setControlsDisabled(true);
  form.setAttribute('aria-busy', 'true');
  submitLabel.textContent = 'Đang tạo tài khoản…';
  setStatusMessage('Đang chuẩn bị tài khoản của bạn…');

  const result = await authService.registerWithEmail({
    displayName: form.elements.displayName.value.trim(),
    email: form.elements.email.value.trim(),
    password: form.elements.password.value
  });

  if (!result.success) {
    showAuthError(result.code);
    return;
  }

  setAuthState(AUTH_STATES.SUCCESS);
  form.setAttribute('aria-busy', 'false');
  setStatusMessage('Tạo tài khoản thành công. Đang chuyển đến trang đăng nhập…', 'success');
  window.setTimeout(() => { window.location.href = getPageUrl('login.html'); }, REDIRECT_DELAY);
}

function bindPasswordToggles() {
  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.target);
      if (!input) return;

      const showingPassword = input.type === 'text';
      input.type = showingPassword ? 'password' : 'text';
      button.textContent = showingPassword ? 'Hiện' : 'Ẩn';
      button.setAttribute('aria-label', showingPassword ? 'Hiện mật khẩu' : 'Ẩn mật khẩu');
    });
  });
}

function bindFieldRecovery() {
  form?.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => {
      setFieldError(input.name, '');
      if ([AUTH_STATES.ERROR, AUTH_STATES.NETWORK_ERROR, AUTH_STATES.RATE_LIMITED, AUTH_STATES.UNVERIFIED_EMAIL]
        .includes(page.dataset.authState)) {
        setAuthState(AUTH_STATES.READY);
        setStatusMessage('');
      }
    });
  });
}

bindPasswordToggles();
bindFieldRecovery();

if (mode === 'login') {
  form?.addEventListener('submit', handleLoginSubmit);
  googleButton?.addEventListener('click', handleGoogleLogin);
  initializeLogin();
} else {
  setAuthState(AUTH_STATES.READY);
  form?.setAttribute('aria-busy', 'false');
  form?.addEventListener('submit', handleRegisterSubmit);
}
