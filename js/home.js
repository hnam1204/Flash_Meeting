import { dashboardService } from './dashboard-service.js';
import { getPageUrl } from './utils.js';
import { authService } from './auth-service.js';

const page = document.body;
const statusBar = document.querySelector('[data-dashboard-status]');
const activeList = document.querySelector('[data-active-list]');
const activeEmpty = document.querySelector('[data-active-empty]');
const activeSection = document.querySelector('.active-section');
const upcomingList = document.querySelector('[data-upcoming-list]');
const recentList = document.querySelector('[data-recent-list]');
const upcomingEmpty = document.querySelector('[data-upcoming-empty]');
const recentEmpty = document.querySelector('[data-recent-empty]');
const upcomingSection = document.querySelector('.upcoming-section');
const recentSection = document.querySelector('.recent-section');
const toast = document.querySelector('[data-toast]');
const notificationPanel = document.querySelector('[data-notification-panel]');
const profilePanel = document.querySelector('[data-profile-panel]');
const notificationTrigger = document.querySelector('[data-notification-trigger]');
const profileTrigger = document.querySelector('[data-profile-trigger]');
let toastTimer;

const STATUS_LABELS = Object.freeze({
  scheduled: 'Sắp tới',
  active: 'Đang diễn ra',
  ended: 'Đã kết thúc',
  cancelled: 'Đã hủy'
});

function setDashboardState(state) {
  page.dataset.dashboardState = state;
}

function wait(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function isLocalDevelopment() {
  return ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function getScenario() {
  if (!isLocalDevelopment()) return 'normal';
  return new URLSearchParams(window.location.search).get('mock') || 'normal';
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

function closePanels() {
  notificationPanel.hidden = true;
  profilePanel.hidden = true;
  notificationTrigger.setAttribute('aria-expanded', 'false');
  profileTrigger.setAttribute('aria-expanded', 'false');
}

function closeMobileMenu() {
  const nav = document.querySelector('.dashboard-nav');
  const trigger = document.querySelector('[data-mobile-menu]');
  nav?.classList.remove('is-open');
  trigger?.setAttribute('aria-expanded', 'false');
}

function togglePanel(panel, trigger) {
  const willOpen = panel.hidden;
  closePanels();
  panel.hidden = !willOpen;
  trigger.setAttribute('aria-expanded', String(willOpen));
}

function renderProfile(user) {
  const displayName = String(user?.displayName || 'Người dùng FLASH MEETING').trim();
  const email = String(user?.email || '').trim();
  const initials = displayName.split(/\s+/).map((part) => part[0]).slice(-2).join('').toUpperCase();
  document.querySelectorAll('[data-profile-name]').forEach((node) => { node.textContent = displayName; });
  document.querySelectorAll('[data-profile-avatar]').forEach((node) => { node.textContent = initials; });
  document.querySelector('[data-profile-email]').textContent = email;
  document.querySelector('[data-greeting-name]').textContent = displayName.split(/\s+/)[0];
}

function renderNotifications(notifications) {
  const list = document.querySelector('[data-notification-list]');
  list.textContent = '';
  notifications.forEach((notification) => {
    const item = document.createElement('article');
    item.className = 'notification-item';
    const icon = document.createElement('span');
    icon.className = 'notification-dot';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = notification.type === 'invite' ? '◉' : notification.type === 'calendar' ? '□' : '◷';
    const copy = document.createElement('div');
    const text = document.createElement('p');
    text.textContent = notification.text;
    const time = document.createElement('time');
    time.textContent = notification.time;
    copy.append(text, time);
    item.append(icon, copy);
    list.append(item);
  });
}

function renderActive(meetings) {
  activeList.textContent = '';
  activeEmpty.hidden = meetings.length > 0;
  setSectionState(activeSection, meetings.length > 0 ? 'ready' : 'empty');
  meetings.forEach((meeting) => activeList.append(createMeetingCard(meeting, 'active')));
}

function createMeetingCard(meeting, variant = 'upcoming') {
  if (variant === 'active') {
    const article = document.createElement('article');
    article.className = 'dashboard-meeting-card active-meeting-card';
    const info = document.createElement('div');
    info.className = 'active-meeting-info';
    const title = document.createElement('h3');
    title.textContent = meeting.title || 'Cuộc họp FLASH MEETING';
    const meta = document.createElement('div');
    meta.className = 'active-meeting-meta';
    const time = document.createElement('span');
    time.textContent = `${meeting.displayTime || 'Đang diễn ra'} · ${meeting.participantCount ?? 0} người`;
    const room = document.createElement('span');
    room.className = 'meeting-card-room';
    room.textContent = meeting.roomCode || '';
    meta.append(time, room);
    info.append(title, meta);

    const action = document.createElement('a');
    action.className = 'meeting-action';
    action.href = `${getPageUrl('prejoin.html')}?room=${encodeURIComponent(meeting.roomCode || '')}`;
    action.textContent = 'Tham gia ngay';
    article.append(info, action);
    return article;
  }

  const article = document.createElement('article');
  article.className = 'dashboard-meeting-card upcoming-meeting-card';
  const top = document.createElement('div');
  top.className = 'meeting-card-top';
  const title = document.createElement('h3');
  title.textContent = meeting.title || 'Cuộc họp FLASH MEETING';
  top.append(title);

  const meta = document.createElement('div');
  meta.className = 'meeting-card-meta';
  const date = document.createElement('span');
  date.textContent = `${meeting.displayDate || 'Chưa có ngày'} · ${meeting.displayTime || 'Chưa có giờ'}`;
  const time = document.createElement('span');
  time.className = 'meeting-card-room';
  time.textContent = meeting.roomCode || '';
  meta.append(date, time);

  const footer = document.createElement('div');
  footer.className = 'meeting-card-footer';
  const participants = document.createElement('span');
  participants.className = 'meeting-participants';
  participants.textContent = `${meeting.participantCount ?? 0} người`;
  footer.append(participants);

  if (meeting.status !== 'ended' && meeting.status !== 'cancelled') {
    const action = document.createElement('a');
    action.className = 'meeting-action';
    action.href = `${getPageUrl('prejoin.html')}?room=${encodeURIComponent(meeting.roomCode || '')}`;
    action.textContent = 'Tham gia';
    footer.append(action);
  } else {
    const action = document.createElement('button');
    action.className = 'meeting-action is-muted';
    action.type = 'button';
    action.textContent = 'Xem chi tiết';
    action.addEventListener('click', () => showToast('Chi tiết cuộc họp sẽ có trong phiên bản tiếp theo.'));
    footer.append(action);
  }

  article.append(top, meta, footer);
  return article;
}

function renderUpcoming(meetings, errorMessage = '') {
  upcomingList.textContent = '';
  upcomingEmpty.hidden = meetings.length !== 0 || Boolean(errorMessage);
  setSectionState(upcomingSection, errorMessage ? 'error' : meetings.length > 0 ? 'ready' : 'empty');
  if (errorMessage) {
    const error = document.createElement('div');
    error.className = 'section-empty section-error';
    const message = document.createElement('strong');
    message.textContent = errorMessage;
    const retry = document.createElement('button');
    retry.className = 'button button-secondary button-small';
    retry.type = 'button';
    retry.textContent = 'Thử lại';
    retry.addEventListener('click', () => initializeDashboard());
    error.append(message, retry);
    upcomingList.append(error);
    return;
  }
  meetings.forEach((meeting) => upcomingList.append(createMeetingCard(meeting, 'upcoming')));
}

function renderRecent(meetings) {
  recentList.textContent = '';
  recentEmpty.hidden = meetings.length !== 0;
  setSectionState(recentSection, meetings.length > 0 ? 'ready' : 'empty');
  meetings.forEach((meeting) => {
    const item = document.createElement('article');
    item.className = 'recent-item';
    const title = document.createElement('div');
    title.className = 'recent-title';
    const icon = document.createElement('span');
    icon.className = 'recent-title-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '◷';
    const titleCopy = document.createElement('span');
    const titleNode = document.createElement('strong');
    titleNode.textContent = meeting.title;
    const hostNode = document.createElement('small');
    hostNode.textContent = `Chủ trì bởi ${meeting.hostName}`;
    titleCopy.append(titleNode, hostNode);
    title.append(icon, titleCopy);

    const date = document.createElement('div');
    date.className = 'recent-meta';
    const dateLabel = document.createElement('small');
    dateLabel.textContent = 'Thời gian';
    date.append(dateLabel, document.createTextNode(meeting.displayDate));
    const duration = document.createElement('div');
    duration.className = 'recent-meta';
    const durationLabel = document.createElement('small');
    durationLabel.textContent = 'Thời lượng';
    duration.append(durationLabel, document.createTextNode(meeting.duration));
    const status = document.createElement('span');
    status.className = 'recent-status';
    status.textContent = STATUS_LABELS[meeting.status];
    const action = document.createElement('button');
    action.className = 'recent-action';
    action.type = 'button';
    action.textContent = 'Xem chi tiết';
    action.addEventListener('click', () => showToast('Chi tiết cuộc họp sẽ có trong phiên bản tiếp theo.'));
    item.append(title, date, duration, status, action);
    recentList.append(item);
  });
}

function renderSkeletons() {
  activeList.textContent = '';
  upcomingList.textContent = '';
  recentList.textContent = '';
  const activeSkeleton = document.createElement('article');
  activeSkeleton.className = 'dashboard-meeting-card active-meeting-card is-skeleton';
  activeList.append(activeSkeleton);
  for (let index = 0; index < 3; index += 1) {
    const skeleton = document.createElement('article');
    skeleton.className = 'dashboard-meeting-card upcoming-meeting-card is-skeleton';
    upcomingList.append(skeleton);
  }
  const recentSkeleton = document.createElement('div');
  recentSkeleton.className = 'dashboard-meeting-card is-skeleton';
  recentSkeleton.style.minHeight = '130px';
  recentList.append(recentSkeleton);
  upcomingEmpty.hidden = true;
  activeEmpty.hidden = true;
  recentEmpty.hidden = true;
  setSectionState(activeSection, 'loading');
  setSectionState(upcomingSection, 'loading');
  setSectionState(recentSection, 'loading');
}

function renderDashboard(data) {
  const errors = data.errors || {};
  renderProfile(data.user);
  renderNotifications(data.notifications);
  renderActive(data.activeMeetings);
  renderUpcoming(data.upcomingMeetings, errors.upcoming);
  renderRecent(data.recentMeetings);
  document.querySelector('[data-unread-count]').textContent = String(data.unreadNotifications);
  document.querySelector('[data-notification-trigger]').setAttribute('aria-label', `Thông báo, ${data.unreadNotifications} thông báo chưa đọc`);
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
  renderUpcoming([], 'Không thể tải dữ liệu cuộc họp.');
  renderRecent([]);
  showStatus('Không thể tải Dashboard lúc này.', 'error', 'Thử lại', () => initializeDashboard());
}

function redirectToLogin() {
  window.location.href = `${getPageUrl('login.html')}?next=index.html`;
}

function logout() {
  authService.clearSession();
  closePanels();
  closeMobileMenu();
  redirectToLogin();
}

function bindInteractions() {
  notificationTrigger.addEventListener('click', () => togglePanel(notificationPanel, notificationTrigger));
  profileTrigger.addEventListener('click', () => togglePanel(profilePanel, profileTrigger));
  document.querySelector('[data-mark-read]').addEventListener('click', () => {
    document.querySelector('[data-unread-count]').textContent = '0';
    notificationTrigger.setAttribute('aria-label', 'Thông báo, không có thông báo chưa đọc');
    showToast('Đã đánh dấu tất cả thông báo là đã đọc.');
  });
  document.querySelector('[data-logout]').addEventListener('click', logout);
  document.querySelectorAll('[data-coming-soon]').forEach((button) => {
    button.addEventListener('click', () => showToast(`${button.dataset.comingSoon} sẽ có trong phiên bản tiếp theo.`));
  });
  document.querySelector('[data-mobile-menu]')?.addEventListener('click', (event) => {
    const nav = document.querySelector('.dashboard-nav');
    const open = nav.classList.toggle('is-open');
    event.currentTarget.setAttribute('aria-expanded', String(open));
    event.currentTarget.setAttribute('aria-label', open ? 'Đóng điều hướng' : 'Mở điều hướng');
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.popover-wrap')) closePanels();
    if (!event.target.closest('.dashboard-header')) closeMobileMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePanels();
      closeMobileMenu();
    }
  });
}

async function initializeDashboard() {
  const scenario = getScenario();
  if (scenario === 'expired') {
    showSessionExpired();
    return;
  }

  setDashboardState('initializing');
  await wait(320);
  if (!authService.getSession()) {
    redirectToLogin();
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
