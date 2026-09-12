const RESULT_KEY = 'flashMeeting.leaveResult';

const RESULT_COPY = Object.freeze({
  LEFT: {
    label: 'Phiên tham gia đã hoàn tất',
    title: 'Bạn đã rời cuộc họp',
    description: 'Bạn đã rời khỏi cuộc họp.'
  },
  ENDED_FOR_ALL: {
    label: 'Cuộc họp đã kết thúc',
    title: 'Cuộc họp đã kết thúc',
    description: 'Bạn đã kết thúc cuộc họp cho tất cả người tham gia.'
  },
  MEETING_ENDED: {
    label: 'Cuộc họp đã kết thúc',
    title: 'Cuộc họp đã kết thúc',
    description: 'Chủ phòng đã kết thúc cuộc họp.'
  },
  REMOVED: {
    label: 'Phiên tham gia đã kết thúc',
    title: 'Bạn không còn ở trong cuộc họp',
    description: 'Phiên tham gia của bạn đã kết thúc.'
  }
});

const FALLBACK_COPY = Object.freeze({
  label: 'Phiên họp đã kết thúc',
  title: 'Cuộc họp đã kết thúc',
  description: 'Cuộc họp này đã kết thúc.'
});

function readResult() {
  try {
    return JSON.parse(sessionStorage.getItem(RESULT_KEY) || 'null');
  } catch {
    return null;
  }
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = String(value ?? '');
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours} giờ`);
  if (minutes || hours) parts.push(`${minutes} phút`);
  if (remainder || !parts.length) parts.push(`${remainder} giây`);
  return parts.join(' ');
}

function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const copy = Object.hasOwn(RESULT_COPY, raw.reason) ? RESULT_COPY[raw.reason] : FALLBACK_COPY;
  const meetingTitle = typeof raw.meetingTitle === 'string' ? raw.meetingTitle.trim() : '';
  const roomCode = typeof raw.roomCode === 'string' ? raw.roomCode.trim() : '';
  const durationSeconds = Number(raw.durationSeconds);
  const hasDetails = Boolean(meetingTitle || roomCode || Number.isFinite(durationSeconds));
  return {
    ...copy,
    meetingTitle,
    roomCode,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    hasDetails
  };
}

function render() {
  const result = normalizeResult(readResult());
  const fallback = FALLBACK_COPY;
  const copy = result || { ...fallback, meetingTitle: '', roomCode: '', durationSeconds: 0, hasDetails: false };
  const summary = document.querySelector('[data-result-summary]');

  setText('[data-result-label]', copy.label);
  setText('[data-result-title]', copy.title);
  setText('[data-result-description]', copy.description);
  document.title = `FLASH MEETING — ${copy.title}`;

  if (summary) summary.hidden = !copy.hasDetails;
  if (copy.hasDetails) {
    setText('[data-result-meeting-title]', copy.meetingTitle || 'Cuộc họp FLASH MEETING');
    setText('[data-result-room-code]', copy.roomCode || '—');
    setText('[data-result-duration]', formatDuration(copy.durationSeconds));
  }
}

render();
