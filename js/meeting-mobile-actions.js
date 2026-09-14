const MOBILE_BREAKPOINT = 680;

function isMobileViewport() {
  return globalThis.matchMedia?.(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches ?? false;
}

export function createMobileActionsController({
  sheet = document.querySelector('[data-mobile-more-sheet]'),
  backdrop = document.querySelector('[data-mobile-more-backdrop]'),
  getState = () => ({}),
  onReaction,
  onRaiseHand,
  onShare,
  onRecording,
  onInvite,
  onLayout,
  onInfo,
  onDevices
} = {}) {
  if (!sheet) return Object.freeze({ open() {}, close() {}, toggle() {}, render() {}, get isOpen() { return false; } });

  const closeButton = sheet.querySelector('[data-mobile-more-close]');
  const title = sheet.querySelector('[data-mobile-more-title]');
  const home = sheet.querySelector('[data-mobile-more-home]');
  const reactionPanel = sheet.querySelector('[data-mobile-more-reactions]');
  const layoutPanel = sheet.querySelector('[data-mobile-more-layout-options]');
  let lastFocusedElement = null;

  function syncTriggers() {
    const open = !sheet.hidden;
    document.querySelectorAll('[data-mobile-more], [data-more-toggle]').forEach((trigger) => {
      trigger.setAttribute('aria-expanded', String(open));
    });
  }

  function resetSubmenus() {
    if (title) title.textContent = 'Thêm tùy chọn';
    if (home) home.hidden = false;
    if (reactionPanel) reactionPanel.hidden = true;
    if (layoutPanel) layoutPanel.hidden = true;
  }

  function close({ restoreFocus = true } = {}) {
    sheet.hidden = true;
    if (backdrop) backdrop.hidden = true;
    document.documentElement.classList.remove('mobile-more-open');
    resetSubmenus();
    syncTriggers();
    if (restoreFocus && lastFocusedElement?.focus) lastFocusedElement.focus({ preventScroll: true });
    lastFocusedElement = null;
  }

  function open(trigger = document.activeElement) {
    lastFocusedElement = trigger;
    render();
    sheet.hidden = false;
    if (backdrop) backdrop.hidden = false;
    document.documentElement.classList.add('mobile-more-open');
    resetSubmenus();
    syncTriggers();
    window.requestAnimationFrame(() => closeButton?.focus({ preventScroll: true }));
  }

  function toggle(trigger = document.activeElement) {
    if (sheet.hidden) open(trigger);
    else close({ restoreFocus: false });
  }

  function invoke(callback, ...args) {
    close({ restoreFocus: false });
    callback?.(...args);
  }

  function showSubmenu(panelToShow) {
    if (title) title.textContent = panelToShow === reactionPanel ? 'Phản ứng' : 'Bố cục';
    if (home) home.hidden = true;
    if (reactionPanel) reactionPanel.hidden = panelToShow !== reactionPanel;
    if (layoutPanel) layoutPanel.hidden = panelToShow !== layoutPanel;
    panelToShow?.querySelector('button')?.focus({ preventScroll: true });
  }

  function handleClick(event) {
    if (event.target === backdrop) {
      close();
      return;
    }
    const closeTrigger = event.target.closest('[data-mobile-more-close]');
    if (closeTrigger) {
      close();
      return;
    }
    const backTrigger = event.target.closest('[data-mobile-more-back]');
    if (backTrigger) {
      resetSubmenus();
      sheet.querySelector('[data-mobile-more-title]')?.focus({ preventScroll: true });
      return;
    }
    const action = event.target.closest('[data-mobile-action]');
    if (!action) return;
    const actionName = action.dataset.mobileAction;
    if (actionName === 'reaction-menu') {
      showSubmenu(reactionPanel);
    } else if (actionName === 'layout-menu') {
      showSubmenu(layoutPanel);
    } else if (actionName === 'reaction') {
      invoke(onReaction, action.dataset.reaction);
    } else if (actionName === 'raise-hand') {
      invoke(onRaiseHand);
    } else if (actionName === 'share') {
      invoke(onShare);
    } else if (actionName === 'recording') {
      invoke(onRecording);
    } else if (actionName === 'invite') {
      invoke(onInvite);
    } else if (actionName === 'layout') {
      invoke(onLayout, action.dataset.view);
    } else if (actionName === 'info') {
      invoke(onInfo);
    } else if (actionName === 'devices') {
      invoke(onDevices);
    }
  }

  function render() {
    const current = getState() || {};
    const localHandRaised = Boolean(current.localHandRaised);
    const recordingActive = Boolean(current.recordingActive);
    const recordingButton = sheet.querySelector('[data-mobile-action="recording"]');
    const recordingLabel = sheet.querySelector('[data-mobile-recording-label]');
    const handLabel = sheet.querySelector('[data-mobile-raise-hand-label]');
    const shareLabel = sheet.querySelector('[data-mobile-share-label]');
    const layoutLabel = sheet.querySelector('[data-mobile-layout-label]');
    const selectedLayout = sheet.querySelector(`[data-mobile-action="layout"][data-view="${current.view === 'speaker' ? 'speaker' : 'grid'}"]`);

    if (handLabel) handLabel.textContent = localHandRaised ? 'Hạ tay' : 'Giơ tay';
    if (shareLabel) shareLabel.textContent = current.localSharing ? 'Dừng chia sẻ màn hình' : 'Chia sẻ màn hình';
    if (recordingButton) {
      recordingButton.hidden = current.isHost !== true;
      recordingButton.setAttribute('aria-pressed', String(recordingActive));
    }
    if (recordingLabel) recordingLabel.textContent = recordingActive ? 'Dừng ghi hình' : 'Ghi hình';
    if (layoutLabel) layoutLabel.textContent = current.view === 'speaker' ? 'Người nói' : 'Lưới';
    sheet.querySelectorAll('[data-mobile-action="layout"]').forEach((button) => {
      button.setAttribute('aria-checked', String(button === selectedLayout));
    });
    sheet.querySelectorAll('[data-mobile-action="share"]').forEach((button) => {
      button.setAttribute('aria-pressed', String(Boolean(current.localSharing)));
    });
  }

  sheet.addEventListener('click', handleClick);
  backdrop?.addEventListener('click', handleClick);

  return Object.freeze({
    open,
    close,
    toggle,
    render,
    get isOpen() { return !sheet.hidden; },
    get isMobileViewport() { return isMobileViewport(); }
  });
}
