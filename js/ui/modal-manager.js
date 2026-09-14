import { createIcon, renderIcons } from './icons.js';

export const MODAL_STATES = Object.freeze({
  CLOSED: 'CLOSED',
  CONFIRMATION: 'CONFIRMATION',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
  INFO: 'INFO'
});

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const STATE_META = Object.freeze({
  [MODAL_STATES.CONFIRMATION]: { eyebrow: 'Xác nhận', icon: 'circle-help', variant: 'confirm' },
  [MODAL_STATES.PROCESSING]: { eyebrow: 'Đang xử lý', icon: 'loader-circle', variant: 'processing' },
  [MODAL_STATES.SUCCESS]: { eyebrow: 'Hoàn tất', icon: 'circle-check', variant: 'success' },
  [MODAL_STATES.ERROR]: { eyebrow: 'Có vấn đề', icon: 'triangle-alert', variant: 'error' },
  [MODAL_STATES.INFO]: { eyebrow: 'Thông tin', icon: 'info', variant: 'info' }
});

let root;
let backdrop;
let dialog;
let icon;
let eyebrow;
let title;
let message;
let content;
let actions;
let previousFocus = null;
let restoreBodyStyle = null;
let active = {
  state: MODAL_STATES.CLOSED,
  resolve: null,
  timer: 0,
  actionBusy: false,
  dismissOnBackdrop: true
};

function createElement(tagName, className = '') {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  return element;
}

function ensureRoot() {
  if (root) return;

  root = document.getElementById('app-modal-root') || createElement('div');
  root.id = 'app-modal-root';
  root.className = 'fm-modal-root';
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');

  backdrop = createElement('div', 'fm-modal-backdrop');
  dialog = createElement('section', 'fm-modal');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'fm-modal-title');
  dialog.tabIndex = -1;

  icon = createElement('span', 'fm-modal__icon');
  icon.setAttribute('aria-hidden', 'true');
  eyebrow = createElement('p', 'fm-modal__eyebrow');
  title = createElement('h2', 'fm-modal__title');
  title.id = 'fm-modal-title';
  message = createElement('p', 'fm-modal__message');
  message.id = 'fm-modal-message';
  content = createElement('div', 'fm-modal__content');
  actions = createElement('div', 'fm-modal__actions');

  dialog.append(icon, eyebrow, title, message, content, actions);
  backdrop.append(dialog);
  root.append(backdrop);
  if (!root.parentElement) document.body.append(root);

  backdrop.addEventListener('click', (event) => {
    if (event.target !== backdrop || !active.dismissOnBackdrop) return;
    closeModal(false);
  });

  document.addEventListener('keydown', handleKeydown);
}

function lockScroll() {
  const body = document.body;
  if (restoreBodyStyle) {
    body.classList.add('fm-modal-open');
    return;
  }
  const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
  restoreBodyStyle = {
    overflow: body.style.overflow,
    paddingRight: body.style.paddingRight
  };
  body.style.overflow = 'hidden';
  if (scrollBarWidth > 0) body.style.paddingRight = `${scrollBarWidth}px`;
  body.classList.add('fm-modal-open');
}

function unlockScroll() {
  if (!restoreBodyStyle) return;
  document.body.style.overflow = restoreBodyStyle.overflow;
  document.body.style.paddingRight = restoreBodyStyle.paddingRight;
  document.body.classList.remove('fm-modal-open');
  restoreBodyStyle = null;
}

function getFocusableElements() {
  return [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => {
    return !element.hidden && element.getClientRects().length > 0;
  });
}

function focusInitialElement(preferredSelector = '') {
  window.requestAnimationFrame(() => {
    if (active.state === MODAL_STATES.CLOSED) return;
    const preferred = preferredSelector ? dialog.querySelector(preferredSelector) : null;
    const firstFocusable = getFocusableElements()[0];
    (preferred || firstFocusable || dialog).focus({ preventScroll: true });
  });
}

function handleKeydown(event) {
  if (active.state === MODAL_STATES.CLOSED) return;

  if (event.key === 'Escape') {
    if (active.state !== MODAL_STATES.PROCESSING) {
      event.preventDefault();
      closeModal(false);
    }
    return;
  }

  if (event.key !== 'Tab') return;
  const focusable = getFocusableElements();
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function setButton(button, label, variant, callback, { focus = false } = {}) {
  button.type = 'button';
  button.className = `fm-modal__button button button-${variant}`;
  button.textContent = label;
  button.addEventListener('click', () => {
    if (active.actionBusy) return;
    active.actionBusy = true;
    button.disabled = true;
    const result = callback?.();
    if (result && typeof result.then === 'function') result.catch(() => {});
  });
  if (focus) button.dataset.initialFocus = 'true';
  return button;
}

function appendAction({ label, variant = 'secondary', callback, focus = false }) {
  const button = createElement('button');
  setButton(button, label, variant, callback, { focus });
  actions.append(button);
  return button;
}

function appendCloseAction(label = 'Đóng', variant = 'secondary') {
  return appendAction({ label, variant, callback: () => closeModal(false) });
}

function settleConfirmation(value) {
  const resolver = active.resolve;
  active.resolve = null;
  resolver?.(Boolean(value));
}

function clearTimer() {
  window.clearTimeout(active.timer);
  active.timer = 0;
}

function closeModal(result = false) {
  ensureRoot();
  if (active.state === MODAL_STATES.CLOSED) return;
  clearTimer();
  if (active.state === MODAL_STATES.CONFIRMATION) settleConfirmation(result);
  active = {
    state: MODAL_STATES.CLOSED,
    resolve: null,
    timer: 0,
    actionBusy: false,
    dismissOnBackdrop: true
  };
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
  dialog.removeAttribute('data-state');
  dialog.removeAttribute('data-variant');
  dialog.className = 'fm-modal';
  content.replaceChildren();
  actions.replaceChildren();
  unlockScroll();

  const focusTarget = previousFocus;
  previousFocus = null;
  if (focusTarget && typeof focusTarget.focus === 'function' && document.contains(focusTarget)) {
    window.requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  }
}

function render(options = {}) {
  ensureRoot();
  const state = options.state;
  const meta = STATE_META[state];
  if (!meta) return;

  if (active.state === MODAL_STATES.CONFIRMATION && active.resolve) settleConfirmation(false);
  clearTimer();
  if (active.state === MODAL_STATES.CLOSED) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  active = {
    state,
    resolve: null,
    timer: 0,
    actionBusy: false,
    dismissOnBackdrop: options.dismissOnBackdrop === true || (options.dismissOnBackdrop !== false && options.variant !== 'danger')
  };

  root.hidden = false;
  root.setAttribute('aria-hidden', 'false');
  dialog.className = `fm-modal${options.className ? ` ${options.className}` : ''}`;
  dialog.dataset.state = state;
  dialog.dataset.variant = options.variant || meta.variant;
  dialog.setAttribute('aria-live', state === MODAL_STATES.PROCESSING ? 'polite' : 'off');

  icon.replaceChildren(createIcon(options.icon || meta.icon, {
    className: state === MODAL_STATES.PROCESSING ? 'fm-modal__spinner' : '',
    label: state === MODAL_STATES.PROCESSING ? 'Đang tải' : ''
  }));
  renderIcons(icon);
  eyebrow.textContent = options.eyebrow || meta.eyebrow;
  title.textContent = String(options.title || 'FLASH MEETING');
  message.textContent = String(options.message || '');
  message.hidden = !options.message;
  if (options.message) dialog.setAttribute('aria-describedby', 'fm-modal-message');
  else dialog.removeAttribute('aria-describedby');
  content.replaceChildren();
  if (options.content instanceof Node) content.append(options.content);
  content.hidden = !content.childNodes.length;
  actions.replaceChildren();

  if (state === MODAL_STATES.CONFIRMATION) {
    appendAction({
      label: options.confirmText || 'Xác nhận',
      variant: options.variant === 'danger' ? 'danger' : 'primary',
      callback: () => { closeModal(true); },
      focus: options.variant === 'danger' ? false : true
    });
    appendAction({
      label: options.cancelText || 'Hủy',
      variant: 'secondary',
      callback: () => { closeModal(false); },
      focus: options.variant === 'danger'
    });
  } else if (state === MODAL_STATES.SUCCESS) {
    if (options.onConfirm || options.confirmText) {
      appendAction({
        label: options.confirmText || 'Đóng',
        variant: 'primary',
        callback: () => { closeModal(false); options.onConfirm?.(); },
        focus: true
      });
      if (options.cancelText) appendCloseAction(options.cancelText, 'secondary');
    } else {
      appendCloseAction('Đóng', 'primary');
    }
  } else if (state === MODAL_STATES.ERROR) {
    if (options.retryText && options.onRetry) {
      appendAction({
        label: options.retryText,
        variant: 'primary',
        callback: () => { closeModal(false); options.onRetry?.(); },
        focus: true
      });
    }
    appendCloseAction('Đóng', options.retryText ? 'secondary' : 'primary');
  } else if (state === MODAL_STATES.INFO) {
    if (Array.isArray(options.actions) && options.actions.length) {
      options.actions.forEach((action, index) => appendAction({
        label: action.label,
        variant: action.variant || (index === 0 ? 'primary' : 'secondary'),
        callback: action.onClick,
        focus: action.focus === true
      }));
    } else {
      appendCloseAction(options.confirmText || 'Đóng', 'primary');
    }
    if (options.cancelText) appendCloseAction(options.cancelText, 'secondary');
  }

  lockScroll();
  options.onOpen?.(dialog);
  const initialFocus = dialog.querySelector('[data-initial-focus="true"]');
  focusInitialElement(initialFocus ? '[data-initial-focus="true"]' : '');
  if (state === MODAL_STATES.SUCCESS && Number.isFinite(options.autoCloseMs) && options.autoCloseMs > 0 && !options.onConfirm) {
    active.timer = window.setTimeout(() => closeModal(false), options.autoCloseMs);
  }
}

function confirm(options = {}) {
  return new Promise((resolve) => {
    render({ ...options, state: MODAL_STATES.CONFIRMATION });
    active.resolve = resolve;
  });
}

function processing(options = {}) {
  render({ ...options, state: MODAL_STATES.PROCESSING, dismissOnBackdrop: false });
  return { close: () => closeModal(false) };
}

function success(options = {}) {
  render({ ...options, state: MODAL_STATES.SUCCESS });
  return { close: () => closeModal(false) };
}

function error(options = {}) {
  render({ ...options, state: MODAL_STATES.ERROR });
  return { close: () => closeModal(false) };
}

function info(options = {}) {
  render({ ...options, state: MODAL_STATES.INFO });
  return { close: () => closeModal(false) };
}

export const modal = Object.freeze({
  confirm,
  processing,
  success,
  error,
  info,
  close: () => closeModal(false),
  getState: () => active.state
});
