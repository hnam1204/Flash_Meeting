import { dashboardService } from './dashboard-service.js';
import { MAX_MEETING_PARTICIPANTS, MEETING_STATUSES, meetingService } from './meeting-service.js';
import { getPageUrl } from './utils.js';
import { authService } from './auth-service.js';
import { protectPage, redirectToLogin } from './auth-guard.js';
import { modal } from './ui/modal-manager.js';
import { createIcon, renderIcons } from './ui/icons.js';
import { createAnalyticsController } from './app-analytics.js';

const page = document.body;
const statusBar = document.querySelector('[data-dashboard-status]');
const activeList = document.querySelector('[data-active-list]');
const activeSection = document.querySelector('.active-section');
const historyList = document.querySelector('[data-history-list]');
const historySection = document.querySelector('.history-section');
const toast = document.querySelector('[data-toast]');
const analyticsController = createAnalyticsController();
const profilePanel = document.querySelector('[data-profile-panel]');
const profileTrigger = document.querySelector('[data-profile-trigger]');
const instantCreateButtons = [...document.querySelectorAll('[data-start-instant]')];
let toastTimer;
let instantCreateInFlight = false;
let logoutPromptInFlight = false;
let logoutInFlight = false;
let currentUser = null;
let activeDurationTimer = 0;
let meetingRefreshTimer = 0;
let meetingRefreshInFlight = false;
let meetingRefreshQueued = false;
let unsubscribeMeetingEvents = null;

renderIcons();

function setDashboardState(state) {
  page.dataset.dashboardState = state;
}

function wait(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatStartTime(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function formatMeetingDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (seconds < 60) return `${seconds} giây`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} giờ ${remainingMinutes} phút` : `${hours} giờ`;
}

function formatElapsedDuration(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return 'đang cập nhật';
  return formatMeetingDuration((Date.now() - timestamp) / 1000);
}

function formatMeetingDateTime(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return 'Thời gian không khả dụng';
  const date = new Date(timestamp);
  const datePart = new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
  const timePart = new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
  return `${datePart} · ${timePart}`;
}

function getHistoryDurationSeconds(meeting) {
  const startedAt = toTimestamp(meeting?.startedAt);
  const endedAt = toTimestamp(meeting?.endedAt);
  if (!startedAt || !endedAt) return null;
  return Math.max(0, Math.floor((endedAt - startedAt) / 1000));
}

function formatParticipantCount(value) {
  const numericCount = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(numericCount)) {
    return 'Số người không khả dụng';
  }
  const participantCount = Math.max(0, Math.min(MAX_MEETING_PARTICIPANTS, numericCount));
  return `${participantCount} người`;
}

function updateActiveDurations() {
  activeList.querySelectorAll('[data-active-duration]').forEach((node) => {
    node.textContent = `Đã diễn ra ${formatElapsedDuration(node.dataset.startedAt)}`;
  });
}

function startActiveDurationTimer() {
  if (activeSection?.hidden || !activeList.querySelector('[data-active-duration]')) {
    stopActiveDurationTimer();
    return;
  }
  if (activeDurationTimer) return;
  updateActiveDurations();
  activeDurationTimer = window.setInterval(updateActiveDurations, 1000);
}

function stopActiveDurationTimer() {
  if (!activeDurationTimer) return;
  window.clearInterval(activeDurationTimer);
  activeDurationTimer = 0;
}

function focusAfterSectionHides(section) {
  if (!section?.contains(document.activeElement)) return;
  const fallback = instantCreateButtons.find((button) => !button.disabled) || profileTrigger;
  fallback?.focus({ preventScroll: true });
}

function hideSection(section) {
  if (!section) return;
  focusAfterSectionHides(section);
  section.hidden = true;
  setSectionState(section, 'hidden');
}

function isLocalDevelopment() {
  return ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function getScenario() {
  if (!isLocalDevelopment()) return 'normal';
  const query = new URLSearchParams(window.location.search);
  if (query.get('demo') === '1') return 'demo';
  return String(query.get('mock') || 'normal').toLowerCase();
}

function showStatus(message, type = 'info', actionLabel = '', action) {
  statusBar.textContent = '';
  const banner = document.createElement('div');
  banner.className = `status-banner${type === 'error' ? ' is-error' : ''}${type === 'expired' ? ' is-expired' : ''}`;
  const messageNode = document.createElement('span');
  messageNode.textContent = message;
  banner.append(messageNode);
  if (actionLabel && action) {
    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.textContent = actionLabel;
    actionButton.addEventListener('click', action);
    banner.append(actionButton);
  }
  statusBar.append(banner);
}

function clearStatus() {
  statusBar.textContent = '';
}

function setSectionState(section, state) {
  if (!section) return;
  section.dataset.sectionState = state;
  section.setAttribute('aria-busy', String(state === 'loading'));
}

function showToast(message, type = 'info') {
  window.clearTimeout(toastTimer);
  toast.hidden = false;
  toast.className = `toast${type === 'error' ? ' is-error' : ''}`;
  toast.textContent = message;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
}

function setInstantCreateState(state) {
  const creating = state === 'creating';
  page.dataset.instantCreateState = state;
  instantCreateButtons.forEach((button) => {
    button.disabled = creating;
    button.setAttribute('aria-busy', String(creating));
    button.querySelector('[data-instant-create-label]')?.replaceChildren(
      document.createTextNode(creating ? 'Đang tạo phòng...' : 'Bắt đầu cuộc họp ngay')
    );
  });
}

async function handleInstantCreate() {
  if (instantCreateInFlight || !currentUser) return;

  instantCreateInFlight = true;
  clearStatus();
  setInstantCreateState('creating');
  modal.processing({ title: 'Đang tạo cuộc họp', message: 'Đang chuẩn bị phòng họp của bạn.' });

  let result;
  try {
    result = await meetingService.createInstantMeeting(currentUser);
  } catch {
    result = { success: false };
  }

  if (!result?.success || !result.meeting?.roomCode) {
    instantCreateInFlight = false;
    setInstantCreateState('error');
    showStatus('Không thể tạo cuộc họp. Vui lòng thử lại.', 'error');
    setInstantCreateState('idle');
    modal.error({
      title: 'Không thể tạo cuộc họp',
      message: 'Vui lòng thử lại.',
      retryText: 'Thử lại',
      onRetry: () => { void handleInstantCreate(); }
    });
    return;
  }

  setInstantCreateState('success');
  window.location.href = `${getPageUrl('prejoin.html')}?room=${encodeURIComponent(result.meeting.roomCode)}`;
}

function closePanels({ restoreFocus = false } = {}) {
  const wasOpen = !profilePanel.hidden;
  profilePanel.hidden = true;
  profileTrigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus && wasOpen) profileTrigger.focus();
}

function toggleProfilePanel() {
  const willOpen = profilePanel.hidden;
  closePanels();
  profilePanel.hidden = !willOpen;
  profileTrigger.setAttribute('aria-expanded', String(willOpen));
}

function renderAvatar(node, initials, avatarUrl) {
  if (!node) return;
  node.textContent = '';
  const safeAvatarUrl = String(avatarUrl || '').trim();
  if (!/^https?:\/\//i.test(safeAvatarUrl)) {
    node.textContent = initials || '?';
    return;
  }

  const image = document.createElement('img');
  image.src = safeAvatarUrl;
  image.alt = '';
  image.loading = 'lazy';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => { node.textContent = initials || '?'; }, { once: true });
  node.append(image);
}

function renderProfile(user) {
  const displayName = String(user?.displayName || 'Gmail user').trim();
  const email = String(user?.email || '').trim();
  const parts = displayName.split(/\s+/).filter(Boolean);
  const initials = parts.map((part) => part[0]).slice(-2).join('').toUpperCase();
  document.querySelectorAll('[data-profile-name]').forEach((node) => { node.textContent = displayName; });
  document.querySelectorAll('[data-profile-avatar]').forEach((node) => renderAvatar(node, initials, user?.avatarUrl));
  document.querySelector('[data-profile-email]')?.replaceChildren(document.createTextNode(email));
  profileTrigger.setAttribute('aria-label', `Mở menu tài khoản của ${displayName}`);
  document.querySelector('[data-greeting-name]')?.replaceChildren(document.createTextNode(displayName));
}

function createMeetingCard(meeting) {
  const article = document.createElement('article');
  article.className = 'dashboard-meeting-card active-meeting-card';

  const header = document.createElement('div');
  header.className = 'active-meeting-header';
  const info = document.createElement('div');
  info.className = 'active-meeting-info';
  const status = document.createElement('span');
  status.className = 'meeting-card-status';
  const statusDot = document.createElement('span');
  statusDot.className = 'status-dot status-dot-live';
  statusDot.setAttribute('aria-hidden', 'true');
  status.append(statusDot, document.createTextNode('Đang diễn ra'));
  const title = document.createElement('h3');
  title.textContent = meeting.title || 'Cuộc họp FLASH MEETING';
  info.append(status, title);

  const action = document.createElement('a');
  action.className = 'meeting-action';
  action.href = `${getPageUrl('prejoin.html')}?room=${encodeURIComponent(meeting.roomCode || '')}`;
  const isCurrentHost = String(meeting.hostId || '') === String(currentUser?.id || '');
  action.append(createIcon('log-in'), document.createTextNode(isCurrentHost ? 'Quay lại cuộc họp' : 'Tham gia ngay'));
  header.append(info, action);

  const meta = document.createElement('div');
  meta.className = 'active-meeting-meta';
  const time = document.createElement('span');
  time.textContent = `Bắt đầu lúc ${formatStartTime(meeting.startedAt)}`;
  const duration = document.createElement('span');
  duration.dataset.activeDuration = 'true';
  duration.dataset.startedAt = String(meeting.startedAt || '');
  duration.textContent = `Đã diễn ra ${formatElapsedDuration(meeting.startedAt)}`;
  const room = document.createElement('span');
  room.className = 'meeting-card-room';
  room.textContent = `Mã phòng: ${meeting.roomCode || '—'}`;
  const participants = document.createElement('span');
  const participantCount = Math.max(0, Math.min(
    MAX_MEETING_PARTICIPANTS,
    Number(meeting.participantCount) || 0
  ));
  participants.textContent = `${participantCount} / ${MAX_MEETING_PARTICIPANTS} thành viên`;
  const host = document.createElement('span');
  host.textContent = `Chủ trì: ${meeting.hostName || '—'}`;
  meta.append(time, duration, room, participants, host);

  article.append(header, meta);
  renderIcons(article);
  return article;
}

function createHistoryDetails(meeting) {
  const details = document.createElement('div');
  details.className = 'history-details';
  const durationSeconds = getHistoryDurationSeconds(meeting);
  [
    ['Mã phòng', meeting?.roomCode || '—'],
    ['Chủ trì', meeting?.hostName || '—'],
    ['Bắt đầu', formatMeetingDateTime(meeting?.startedAt)],
    ['Kết thúc', formatMeetingDateTime(meeting?.endedAt)],
    ['Thời lượng', durationSeconds === null ? 'Thời lượng không khả dụng' : formatMeetingDuration(durationSeconds)],
    ['Người tham gia', formatParticipantCount(meeting?.participantCount)]
  ].forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'history-detail-row';
    const labelNode = document.createElement('span');
    labelNode.textContent = label;
    const valueNode = document.createElement('strong');
    valueNode.textContent = value;
    row.append(labelNode, valueNode);
    details.append(row);
  });
  return details;
}

function openHistoryDetails(meeting) {
  modal.info({
    eyebrow: 'Lịch sử cuộc họp',
    title: 'Chi tiết cuộc họp',
    content: createHistoryDetails(meeting),
    confirmText: 'Đóng'
  });
}

function createHistoryCard(meeting) {
  const article = document.createElement('article');
  article.className = 'dashboard-meeting-card history-meeting-card';

  const content = document.createElement('div');
  content.className = 'history-meeting-content';
  const header = document.createElement('div');
  header.className = 'history-meeting-header';
  const title = document.createElement('h3');
  title.textContent = meeting?.title || 'Cuộc họp FLASH MEETING';
  const status = document.createElement('span');
  status.className = 'history-meeting-status';
  status.textContent = 'Đã kết thúc';
  header.append(title, status);

  const started = document.createElement('p');
  started.className = 'history-meeting-time';
  started.textContent = formatMeetingDateTime(meeting?.startedAt);

  const meta = document.createElement('div');
  meta.className = 'history-meeting-meta';
  const durationSeconds = getHistoryDurationSeconds(meeting);
  [
    durationSeconds === null ? 'Thời lượng không khả dụng' : formatMeetingDuration(durationSeconds),
    formatParticipantCount(meeting?.participantCount),
    `Mã phòng: ${meeting?.roomCode || '—'}`,
    `Chủ trì: ${meeting?.hostName || '—'}`
  ].forEach((value) => {
    const item = document.createElement('span');
    item.textContent = value;
    meta.append(item);
  });

  content.append(header, started, meta);
  const detailsButton = document.createElement('button');
  detailsButton.type = 'button';
  detailsButton.className = 'button button-ghost history-detail-button';
  detailsButton.textContent = 'Chi tiết';
  detailsButton.setAttribute('aria-label', `Xem chi tiết cuộc họp ${meeting?.title || 'FLASH MEETING'}`);
  detailsButton.addEventListener('click', () => openHistoryDetails(meeting));
  article.append(content, detailsButton);
  return article;
}

function renderActive(meetings = []) {
  const activeMeetings = Array.isArray(meetings)
    ? meetings.filter((meeting) => meeting?.status === MEETING_STATUSES.ACTIVE)
    : [];
  if (!activeMeetings.length) {
    stopActiveDurationTimer();
    focusAfterSectionHides(activeSection);
    activeList.replaceChildren();
    hideSection(activeSection);
    return;
  }

  activeList.replaceChildren();
  activeSection.hidden = false;
  activeMeetings.forEach((meeting) => activeList.append(createMeetingCard(meeting)));
  setSectionState(activeSection, 'ready');
  startActiveDurationTimer();
}

function renderHistory(meetings = []) {
  const historyMeetings = Array.isArray(meetings)
    ? meetings
      .filter((meeting) => meeting?.status === MEETING_STATUSES.ENDED)
      .sort((left, right) => (
        (toTimestamp(right.endedAt) || toTimestamp(right.startedAt) || 0)
        - (toTimestamp(left.endedAt) || toTimestamp(left.startedAt) || 0)
      ))
    : [];
  if (!historyMeetings.length) {
    focusAfterSectionHides(historySection);
    historyList.replaceChildren();
    hideSection(historySection);
    return;
  }

  historyList.replaceChildren();
  historySection.hidden = false;
  historyMeetings.forEach((meeting) => historyList.append(createHistoryCard(meeting)));
  setSectionState(historySection, 'ready');
}

function renderSkeletons() {
  renderActive([]);
  renderHistory([]);
}

function renderDashboard(data) {
  const errors = data.errors || {};
  renderProfile(data.user);
  renderActive(data.activeMeetings || []);
  renderHistory(data.meetingHistory || []);
  if (data.offline) {
    showStatus('Bạn đang ngoại tuyến. Một số dữ liệu có thể chưa được cập nhật.', 'info');
    setDashboardState('offline');
  } else if (Object.keys(errors).length) {
    showStatus('Một số dữ liệu chưa thể tải. Các phần còn lại vẫn sẵn sàng.', 'error', 'Thử lại', () => initializeDashboard());
    setDashboardState('partial_error');
  } else {
    clearStatus();
    setDashboardState('ready');
  }
}

function showSessionExpired() {
  setDashboardState('session_expired');
  renderSkeletons();
  showStatus('Phiên đăng nhập đã hết hạn.', 'expired', 'Đăng nhập lại', () => redirectToLogin());
}

function showDashboardError() {
  setDashboardState('error');
  renderActive([]);
  renderHistory([]);
  showStatus('Không thể tải Dashboard lúc này.', 'error', 'Thử lại', () => initializeDashboard());
}

async function refreshActiveMeetings() {
  if (!currentUser) return;
  if (meetingRefreshInFlight) {
    meetingRefreshQueued = true;
    return;
  }

  meetingRefreshInFlight = true;
  try {
    const data = await dashboardService.load({ scenario: getScenario() });
    renderActive(data.activeMeetings || []);
    renderHistory(data.meetingHistory || []);
  } catch {
    showToast('Không thể cập nhật cuộc họp đang diễn ra.', 'error');
  } finally {
    meetingRefreshInFlight = false;
    if (meetingRefreshQueued) {
      meetingRefreshQueued = false;
      void refreshActiveMeetings();
    }
  }
}

function scheduleMeetingRefresh() {
  window.clearTimeout(meetingRefreshTimer);
  meetingRefreshTimer = window.setTimeout(() => {
    meetingRefreshTimer = 0;
    void refreshActiveMeetings();
  }, 80);
}

function handleMeetingEvent(event) {
  if (!['MEETING_STARTED', 'MEETING_ENDED', 'MEETING_UPDATED'].includes(event?.type)) return;
  scheduleMeetingRefresh();
}

function destroyDashboard() {
  stopActiveDurationTimer();
  window.clearTimeout(meetingRefreshTimer);
  meetingRefreshTimer = 0;
  unsubscribeMeetingEvents?.();
  unsubscribeMeetingEvents = null;
  analyticsController.destroy();
}

function handleDashboardPageHide(event) {
  if (!event.persisted) destroyDashboard();
}

async function performLogout() {
  const logoutButton = document.querySelector('[data-logout]');
  if (!logoutButton || logoutInFlight) return;
  logoutInFlight = true;
  logoutButton.disabled = true;
  modal.processing({ title: 'Đang đăng xuất', message: 'Đang kết thúc phiên đăng nhập của bạn.' });
  let result;
  try {
    result = await authService.signOut();
  } catch {
    result = { success: false };
  }
  if (!result?.success) {
    logoutInFlight = false;
    logoutButton.disabled = false;
    modal.error({
      title: 'Không thể đăng xuất',
      message: 'Vui lòng thử lại.',
      retryText: 'Thử lại',
      onRetry: () => { void performLogout(); }
    });
    return;
  }
  closePanels();
  window.location.href = authService.getLoginUrl('index.html');
}

async function logout() {
  if (logoutPromptInFlight || logoutInFlight) return;
  logoutPromptInFlight = true;
  const confirmed = await modal.confirm({
    title: 'Đăng xuất?',
    message: 'Bạn sẽ cần đăng nhập lại bằng Google để tiếp tục sử dụng FLASH MEETING.',
    confirmText: 'Đăng xuất',
    cancelText: 'Hủy',
    variant: 'danger',
    dismissOnBackdrop: false
  });
  logoutPromptInFlight = false;
  if (confirmed) await performLogout();
}

function bindInteractions() {
  profileTrigger.addEventListener('click', toggleProfilePanel);
  document.querySelector('[data-logout]').addEventListener('click', logout);
  instantCreateButtons.forEach((button) => button.addEventListener('click', handleInstantCreate));
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.popover-wrap')) closePanels();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePanels({ restoreFocus: true });
  });
  unsubscribeMeetingEvents = meetingService.subscribeMeetingEvents(handleMeetingEvent);
  window.addEventListener('pagehide', handleDashboardPageHide);
  window.addEventListener('beforeunload', destroyDashboard, { once: true });
}

async function initializeDashboard() {
  const scenario = getScenario();
  setDashboardState('initializing');
  await wait(320);
  const sessionResult = await protectPage();
  if (!sessionResult.success || !sessionResult.session) return;
  currentUser = sessionResult.user;
  analyticsController.start();
  setInstantCreateState('idle');
  renderProfile(sessionResult.user);

  if (scenario === 'expired') {
    showSessionExpired();
    return;
  }

  setDashboardState('loading');
  renderSkeletons();
  try {
    const data = await dashboardService.load({ scenario });
    renderDashboard(data);
  } catch {
    showDashboardError();
  }
}

bindInteractions();
initializeDashboard();
