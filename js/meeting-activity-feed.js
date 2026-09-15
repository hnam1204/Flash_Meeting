import { validateMeetingDisplayName } from './display-name.js';

const MAX_VISIBLE_NOTICES = 3;
const NOTICE_LIFETIME_MS = 4_200;
const DEDUPE_WINDOW_MS = 3_000;
const REMOVED_SUPPRESSION_MS = 8_000;

const NOTICE_COPY = Object.freeze({
  joined: { icon: '+', message: (name) => `${name} đã tham gia cuộc họp` },
  left: { icon: '−', message: (name) => `${name} đã rời cuộc họp` },
  removed: { icon: '×', message: (name) => `${name} đã bị xóa khỏi cuộc họp` },
  shareStarted: { icon: '↗', message: (name) => `${name} đang chia sẻ màn hình` },
  shareStopped: { icon: '↙', message: (name) => `${name} đã dừng chia sẻ màn hình` }
});

export function createMeetingActivityFeed({ element = document.querySelector('[data-activity-feed]') } = {}) {
  const notices = [];
  const removedParticipants = new Map();

  function removeNotice(notice) {
    const index = notices.indexOf(notice);
    if (index >= 0) notices.splice(index, 1);
    window.clearTimeout(notice.timer);
    notice.node.remove();
  }

  function removeMatching(type, participantKey) {
    notices
      .filter((notice) => notice.type === type && notice.participantKey === participantKey)
      .forEach(removeNotice);
  }

  function publish(type, { participantId = '', name = '' } = {}) {
    const copy = NOTICE_COPY[type];
    if (!copy || !element) return;
    const displayName = validateMeetingDisplayName(name);
    if (!displayName.valid) return;
    const participantKey = String(participantId).trim() || displayName.value;
    if (type === 'left' && removedParticipants.has(participantKey)) return;
    if (type === 'removed') {
      window.clearTimeout(removedParticipants.get(participantKey));
      removedParticipants.set(participantKey, window.setTimeout(() => removedParticipants.delete(participantKey), REMOVED_SUPPRESSION_MS));
      removeMatching('left', participantKey);
    }

    const dedupeKey = `${type}:${participantKey}`;
    const existing = notices.find((notice) => notice.dedupeKey === dedupeKey);
    if (existing && Date.now() - existing.createdAt < DEDUPE_WINDOW_MS) {
      window.clearTimeout(existing.timer);
      existing.createdAt = Date.now();
      existing.timer = window.setTimeout(() => removeNotice(existing), NOTICE_LIFETIME_MS);
      return;
    }

    const node = document.createElement('div');
    node.className = `meeting-activity-notice is-${type}`;
    node.dataset.activityType = type;
    node.dataset.participantKey = participantKey;
    const icon = document.createElement('span');
    icon.className = 'meeting-activity-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = copy.icon;
    const text = document.createElement('span');
    text.className = 'meeting-activity-copy';
    text.textContent = copy.message(displayName.value);
    node.append(icon, text);
    const notice = { node, type, participantKey, dedupeKey, createdAt: Date.now(), timer: 0 };
    notices.unshift(notice);
    element.prepend(node);
    notice.timer = window.setTimeout(() => removeNotice(notice), NOTICE_LIFETIME_MS);
    while (notices.length > MAX_VISIBLE_NOTICES) removeNotice(notices[notices.length - 1]);
  }

  function clear() {
    [...notices].forEach(removeNotice);
    removedParticipants.forEach((timer) => window.clearTimeout(timer));
    removedParticipants.clear();
  }

  return Object.freeze({
    joined: (participant) => publish('joined', participant),
    left: (participant) => publish('left', participant),
    removed: (participant) => publish('removed', participant),
    shareStarted: (participant) => publish('shareStarted', participant),
    shareStopped: (participant) => publish('shareStopped', participant),
    clear,
    destroy: clear
  });
}
