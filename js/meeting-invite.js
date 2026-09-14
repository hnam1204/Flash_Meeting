import { getMeetingInviteUrl, normalizeRoomCode } from './utils.js';
import { createIcon, renderIcons } from './ui/icons.js';
import { modal } from './ui/modal-manager.js';

const QR_OPTIONS = Object.freeze({
  errorCorrectionLevel: 'M',
  margin: 2,
  width: 210,
  color: {
    dark: '#171513',
    light: '#ffffff'
  }
});

const qrCache = new Map();
let qrLibraryPromise = null;

function createElement(tagName, className = '') {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  return element;
}

function loadQrLibrary() {
  if (!qrLibraryPromise) {
    qrLibraryPromise = import('qrcode').then((module) => module.default || module);
  }
  return qrLibraryPromise;
}

export async function copyToClipboard(value) {
  const text = String(value ?? '');
  if (!text) return false;

  try {
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the compatibility path below.
  }

  const fallback = createElement('textarea');
  fallback.value = text;
  fallback.setAttribute('readonly', '');
  fallback.style.position = 'fixed';
  fallback.style.top = '0';
  fallback.style.left = '-9999px';
  fallback.style.opacity = '0';
  document.body.append(fallback);
  fallback.focus();
  fallback.select();

  try {
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    fallback.remove();
  }
}

function setCopyButtonContent(button, label, iconName) {
  button.replaceChildren(createIcon(iconName), document.createTextNode(label));
  renderIcons(button);
}

function bindCopyAction(button, value, feedback, { defaultLabel, successLabel, iconOnly = false } = {}) {
  let feedbackTimer = 0;
  const reset = () => {
    if (iconOnly) {
      button.replaceChildren(createIcon('copy'));
      button.setAttribute('aria-label', defaultLabel);
      renderIcons(button);
    } else {
      setCopyButtonContent(button, defaultLabel, 'copy');
    }
    feedback.textContent = '';
  };

  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    const copied = await copyToClipboard(value);
    button.disabled = false;
    window.clearTimeout(feedbackTimer);

    if (!copied) {
      feedback.textContent = 'Không thể sao chép. Hãy thử lại trên trình duyệt được hỗ trợ.';
      return;
    }

    feedback.textContent = successLabel;
    if (iconOnly) {
      button.replaceChildren(createIcon('circle-check'));
      button.setAttribute('aria-label', successLabel);
      renderIcons(button);
    } else {
      setCopyButtonContent(button, successLabel, 'circle-check');
    }
    feedbackTimer = window.setTimeout(reset, 1800);
  });
}

function createCopyIconButton({ value, label, feedback }) {
  const button = createElement('button', 'fm-icon-button fm-invite-copy-code');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.append(createIcon('copy'));
  renderIcons(button);
  bindCopyAction(button, value, feedback, {
    defaultLabel: label,
    successLabel: 'Đã sao chép',
    iconOnly: true
  });
  return button;
}

function createTextCopyButton({ value, label, feedback }) {
  const button = createElement('button', 'button button-primary fm-invite-copy-link');
  button.type = 'button';
  setCopyButtonContent(button, label, 'copy');
  bindCopyAction(button, value, feedback, {
    defaultLabel: label,
    successLabel: 'Đã sao chép'
  });
  return button;
}

async function renderQrCode(frame, status, inviteUrl) {
  const cacheKey = inviteUrl;
  const cachedDataUrl = qrCache.get(cacheKey);
  if (cachedDataUrl) {
    const image = new Image();
    image.width = QR_OPTIONS.width;
    image.height = QR_OPTIONS.width;
    image.alt = 'Mã QR tham gia cuộc họp';
    image.src = cachedDataUrl;
    frame.replaceChildren(image);
    frame.dataset.state = 'ready';
    return;
  }

  frame.dataset.state = 'loading';
  status.textContent = 'Đang tạo mã QR…';
  try {
    const qrCode = await loadQrLibrary();
    const dataUrl = await qrCode.toDataURL(inviteUrl, QR_OPTIONS);
    qrCache.set(cacheKey, dataUrl);
    if (!frame.isConnected) return;

    const image = new Image();
    image.width = QR_OPTIONS.width;
    image.height = QR_OPTIONS.width;
    image.alt = 'Mã QR tham gia cuộc họp';
    image.src = dataUrl;
    frame.replaceChildren(image);
    frame.dataset.state = 'ready';
  } catch {
    if (!frame.isConnected) return;
    frame.dataset.state = 'error';
    status.textContent = 'Không thể tạo mã QR. Bạn vẫn có thể sao chép link tham gia.';
  }
}

function createInviteContent(meeting, participantCount) {
  const roomCode = normalizeRoomCode(meeting.roomCode);
  const inviteUrl = getMeetingInviteUrl(roomCode);
  const maxParticipants = Number(meeting.maxParticipants) > 0 ? Number(meeting.maxParticipants) : 50;
  const title = String(meeting.title || 'Cuộc họp FLASH MEETING').trim();
  const layout = createElement('div', 'fm-invite-layout');

  const details = createElement('section', 'fm-invite-details');
  const meetingBlock = createElement('div', 'fm-invite-meeting');
  const meetingLabel = createElement('span', 'fm-invite-label');
  meetingLabel.textContent = 'Cuộc họp';
  const meetingTitle = createElement('strong', 'fm-invite-meeting-title');
  meetingTitle.textContent = title;
  meetingBlock.append(meetingLabel, meetingTitle);
  if (participantCount !== null && participantCount !== undefined && Number.isFinite(Number(participantCount))) {
    const participantMeta = createElement('small', 'fm-invite-participant-count');
    participantMeta.textContent = `${Math.max(0, Number(participantCount))} / ${maxParticipants} người đang tham gia`;
    meetingBlock.append(participantMeta);
  }

  const feedback = createElement('p', 'fm-invite-feedback');
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');

  const codeBlock = createElement('div', 'fm-invite-code');
  const codeLabel = createElement('span', 'fm-invite-label');
  codeLabel.textContent = 'Mã phòng';
  const codeValue = createElement('div', 'fm-invite-code-value');
  const codeText = createElement('strong');
  codeText.textContent = roomCode;
  codeValue.append(codeText, createCopyIconButton({
    value: roomCode,
    label: 'Sao chép mã phòng',
    feedback
  }));
  codeBlock.append(codeLabel, codeValue);
  details.append(meetingBlock, codeBlock);

  const qrColumn = createElement('section', 'fm-invite-qr-column');
  const qrFrame = createElement('div', 'fm-invite-qr');
  qrFrame.setAttribute('aria-label', 'Mã QR tham gia cuộc họp');
  const qrStatus = createElement('span', 'fm-invite-qr-status');
  qrStatus.setAttribute('role', 'status');
  qrStatus.textContent = 'Đang chuẩn bị mã QR…';
  qrFrame.append(qrStatus);
  const qrHelper = createElement('p', 'fm-invite-qr-helper');
  qrHelper.textContent = 'Quét mã QR để tham gia nhanh';
  qrColumn.append(qrFrame, qrHelper);

  const linkBlock = createElement('section', 'fm-invite-link');
  const linkLabel = createElement('span', 'fm-invite-label');
  linkLabel.textContent = 'Link tham gia';
  const linkValue = createElement('code');
  linkValue.textContent = inviteUrl;
  linkBlock.append(linkLabel, linkValue);

  const actionRow = createElement('div', 'fm-invite-actions');
  const copyLinkButton = createTextCopyButton({
    value: inviteUrl,
    label: 'Sao chép link',
    feedback
  });
  actionRow.append(copyLinkButton);

  if (typeof navigator.share === 'function') {
    const shareButton = createElement('button', 'button button-secondary fm-invite-share');
    shareButton.type = 'button';
    setCopyButtonContent(shareButton, 'Chia sẻ', 'share-2');
    shareButton.addEventListener('click', async () => {
      if (shareButton.disabled) return;
      shareButton.disabled = true;
      try {
        await navigator.share({
          title,
          text: `Tham gia cuộc họp FLASH MEETING: ${title}`,
          url: inviteUrl
        });
      } catch (error) {
        if (error?.name !== 'AbortError') feedback.textContent = 'Không thể mở bảng chia sẻ. Bạn có thể sao chép link.';
      } finally {
        shareButton.disabled = false;
      }
    });
    actionRow.append(shareButton);
  }

  layout.append(details, qrColumn, linkBlock, actionRow, feedback);
  return { layout, qrFrame, qrStatus, inviteUrl };
}

export function createMeetingInviteController({ getMeeting, getParticipantCount } = {}) {
  return Object.freeze({
    open() {
      const meeting = getMeeting?.() || {};
      const roomCode = normalizeRoomCode(meeting.roomCode);
      if (!getMeetingInviteUrl(roomCode)) return;

      const { layout, qrFrame, qrStatus } = createInviteContent({ ...meeting, roomCode }, getParticipantCount?.());
      modal.info({
        eyebrow: 'Mời thành viên',
        title: 'Mời tham gia cuộc họp',
        icon: 'user-plus',
        content: layout,
        className: 'fm-invite-modal',
        confirmText: 'Đóng'
      });
      void renderQrCode(qrFrame, qrStatus, getMeetingInviteUrl(roomCode));
    }
  });
}
