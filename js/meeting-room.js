import { appendChatMessage } from './meeting-chat.js';
import { createMediaController } from './meeting-media.js';
import {
  createParticipantStore,
  filterParticipants,
  getParticipantRoleCounts,
  getParticipantRoleLabel,
  PARTICIPANT_ROLES,
  PARTICIPANT_TABS
} from './meeting-participants.js';
import {
  canUseHostAction,
  getHostActionFailureMessage,
  getParticipantActions,
  HOST_ACTIONS
} from './meeting-host-controls.js';
import {
  cleanupScreenShare,
  isScreenShareSupported,
  startMockRemoteShare,
  startScreenShare,
  stopScreenShare,
  stopMockRemoteShare,
  subscribeScreenShare
} from './meeting-screen-share.js';
import { getPageUrl } from './utils.js';

const MAX_PARTICIPANTS = 50;
const FILMSTRIP_DEFAULT_SIZE = 6;
const DEFAULT_DURATION_SECONDS = (24 * 60) + 17;

const names = [
  'Minh Anh', 'Quang Huy', 'Lan Chi', 'Đức Minh', 'Hà My', 'Bảo Ngọc', 'Tuấn Khang',
  'Phương Linh', 'Hoàng Nam', 'Thùy Dương', 'Gia Bảo', 'Khánh Vy', 'Trung Kiên',
  'Mai Phương', 'Thanh Tùng', 'Ngọc Hân', 'Anh Duy', 'Thảo Nhi', 'Việt Anh',
  'Yến Nhi', 'Mạnh Hùng', 'Thu Trang', 'Đăng Khoa', 'Hải Yến', 'Thanh Hà',
  'Đình Phúc', 'Nhật Minh', 'Kim Anh', 'Thiên Long', 'Hương Giang', 'Vũ Hoàng',
  'Ngọc Mai', 'Trí Dũng', 'Mai Anh', 'Hoài Nam', 'Khôi Nguyên', 'Thành Đạt',
  'Linh Đan', 'Đức Anh', 'Phúc An', 'Quỳnh Anh', 'Minh Khoa', 'Thái Sơn',
  'Huyền Trang', 'Tấn Phát', 'Thanh Vy', 'Hoàng Long', 'Bích Ngọc', 'Đông Quân'
];

const scenario = String(new URLSearchParams(window.location.search).get('mock') ?? '').toLowerCase();
const roleQuery = new URLSearchParams(window.location.search).get('role');
const role = scenario === 'host' || roleQuery === 'host'
  ? PARTICIPANT_ROLES.HOST
  : scenario === 'cohost' || roleQuery === 'cohost'
    ? PARTICIPANT_ROLES.CO_HOST
    : PARTICIPANT_ROLES.MEMBER;
const media = createMediaController();
const page = document.body;
const app = document.querySelector('.meeting-app');
const panel = document.querySelector('[data-side-panel]');
const filmstrip = document.querySelector('[data-filmstrip]');
const gridTiles = document.querySelector('[data-grid-tiles]');
const stage = document.querySelector('[data-stage-view="speaker"]');
const presentationStage = document.querySelector('[data-presentation-stage]');
const presentationVideo = document.querySelector('[data-screen-share-video]');
const remoteSharePlaceholder = document.querySelector('[data-remote-share-placeholder]');
const presentationEmpty = document.querySelector('[data-presentation-empty]');
const state = {
  roomCode: getRoomCode(),
  meetingTitle: getMeetingTitle(),
  displayName: getStoredDisplayName(),
  hostName: 'Nguyễn Hải Nam',
  startedAt: getStartedAt(),
  role,
  panel: null,
  participantTab: PARTICIPANT_TABS.JOINED,
  participantMenuId: null,
  pendingConfirmation: null,
  waitingParticipants: [],
  view: 'speaker',
  filmstripPage: 0,
  filmstripSize: FILMSTRIP_DEFAULT_SIZE,
  activeParticipantId: 'participant-1',
  messages: [
    { author: 'Minh Anh', content: 'Mọi người nghe rõ không?' },
    { author: 'Quang Huy', content: 'Mình nghe rõ, bắt đầu nhé.' },
    { author: 'Lan Chi', content: 'Mình đã mở tài liệu rồi.' }
  ],
  unreadCount: scenario === 'chat-unread' ? 3 : 0,
  toastTimer: 0,
  timer: 0,
  speakerTimer: 0,
  reconnectTimer: 0,
  screenShare: {
    active: false,
    presenterId: null,
    isLocalPresenter: false,
    stream: null
  },
  unsubscribeScreenShare: null,
  participants: null
};

function readSession(key) {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeSession(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Session storage is optional in mock mode.
  }
}

function getRoomCode() {
  const queryCode = new URLSearchParams(window.location.search).get('room');
  return String(queryCode || readSession('flashMeeting.roomCode') || 'ABC-123-XYZ').trim().toUpperCase();
}

function getMeetingTitle() {
  try {
    const storedMeeting = JSON.parse(readSession('flashMeeting.joinedMeeting') || 'null');
    return storedMeeting?.title || 'Cuộc họp nhóm sản phẩm';
  } catch {
    return 'Cuộc họp nhóm sản phẩm';
  }
}

function getStoredDisplayName() {
  return readSession('flashMeeting.displayName').trim() || 'Nguyễn Hải Nam';
}

function getStartedAt() {
  const storedMeetingStartedAt = (() => {
    try {
      const storedMeeting = JSON.parse(readSession('flashMeeting.joinedMeeting') || 'null');
      return Number(storedMeeting?.startedAt);
    } catch {
      return 0;
    }
  })();
  const storedStartedAt = Number(readSession('flashMeeting.startedAt'));
  const startedAt = storedMeetingStartedAt || storedStartedAt;
  if (Number.isFinite(startedAt) && startedAt > 0) return startedAt;

  const mockStartedAt = Date.now() - (DEFAULT_DURATION_SECONDS * 1000);
  writeSession('flashMeeting.startedAt', String(mockStartedAt));
  return mockStartedAt;
}

function getParticipantCount() {
  if (scenario === 'only-local') return 1;
  if (scenario === 'many-participants' || scenario === 'room-full' || scenario === 'full') return MAX_PARTICIPANTS;
  return 24;
}

function isRemoteShareScenario() {
  return ['remote-presenting', 'remote-share', 'presentation'].includes(scenario);
}

function createWaitingParticipants() {
  const shouldShowWaiting = ['waiting-users', 'waiting-room', 'host', 'cohost'].includes(scenario) || scenario === 'room-full';
  if (!shouldShowWaiting || scenario === 'no-waiting-users') return [];
  return [
    { id: 'waiting-1', name: 'Nguyễn Thu Hà', status: 'waiting' },
    { id: 'waiting-2', name: 'Phạm Đức Long', status: 'waiting' },
    { id: 'waiting-3', name: 'Lê Minh Trang', status: 'waiting' }
  ];
}

function getInitials(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words.at(-1)[0]}`.toUpperCase();
}

function createParticipants() {
  const count = getParticipantCount();
  const localCameraEnabled = scenario !== 'camera-off';
  const localMicrophoneEnabled = scenario !== 'mic-off';
  const local = {
    id: 'local',
    name: state.displayName,
    role: state.role,
    local: true,
    cameraEnabled: localCameraEnabled,
    microphoneEnabled: localMicrophoneEnabled,
    speaking: false,
    handRaised: false,
    shareScreenAllowed: true
  };
  const participants = [local];
  for (let index = 1; index < count; index += 1) {
    participants.push({
      id: `participant-${index}`,
      name: names[index - 1] || `Thành viên ${index}`,
      role: index === 1 ? 'co-host' : 'member',
      local: false,
      cameraEnabled: scenario !== 'camera-off' && !(index % 11 === 0),
      microphoneEnabled: scenario !== 'mic-off' && index % 7 !== 0,
      speaking: index === 1,
      handRaised: index === 4,
      shareScreenAllowed: true
    });
  }
  return createParticipantStore(participants);
}

function getParticipants() {
  return state.participants.list();
}

function getLocalParticipant() {
  return getParticipants().find((participant) => participant.local) || getParticipants()[0];
}

function findParticipant(id) {
  return getParticipants().find((participant) => participant.id === id) || getLocalParticipant();
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = String(value ?? '');
  return element;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const remainder = String(seconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${remainder}`;
}

function updateDuration() {
  setText('[data-meeting-duration]', formatDuration((Date.now() - state.startedAt) / 1000));
}

function getFilmstripSize() {
  if (window.innerWidth <= 680) return 3;
  if (window.innerWidth <= 900) return 4;
  if (window.innerWidth <= 1180) return 5;
  return FILMSTRIP_DEFAULT_SIZE;
}

function createParticipantVisual(participant) {
  const visual = document.createElement('div');
  visual.className = 'participant-visual';
  if (!participant.cameraEnabled) visual.classList.add('camera-off');
  const avatar = document.createElement('span');
  avatar.className = 'participant-avatar';
  avatar.textContent = getInitials(participant.name);
  visual.append(avatar);
  return visual;
}

function createParticipantTile(participant, tileType = 'filmstrip') {
  const tile = document.createElement(tileType === 'grid' ? 'article' : 'button');
  tile.className = tileType === 'grid' ? 'grid-tile participant-tile' : 'participant-tile';
  tile.type = tileType === 'grid' ? undefined : 'button';
  tile.setAttribute('role', tileType === 'grid' ? 'listitem' : 'listitem');
  tile.classList.toggle('is-local', participant.local);
  tile.classList.toggle('is-speaking', participant.speaking);
  tile.classList.toggle('is-active', participant.id === state.activeParticipantId);
  tile.setAttribute('aria-label', `${participant.name}${participant.local ? ' (Bạn)' : ''}`);

  if (participant.local) {
    const localBadge = document.createElement('span');
    localBadge.className = 'participant-local';
    localBadge.textContent = 'Bạn';
    tile.append(localBadge);
  }
  if (participant.handRaised) {
    const hand = document.createElement('span');
    hand.className = 'participant-hand';
    hand.textContent = '✋';
    hand.setAttribute('aria-label', 'Đang giơ tay');
    tile.append(hand);
  }
  if (state.screenShare.presenterId === participant.id) {
    const presenter = document.createElement('span');
    presenter.className = 'participant-hand participant-presenter';
    presenter.textContent = '▣';
    presenter.setAttribute('aria-label', 'Đang trình bày');
    tile.append(presenter);
  }

  tile.append(createParticipantVisual(participant));
  const footer = document.createElement('span');
  footer.className = 'participant-footer';
  const name = document.createElement('span');
  name.className = 'participant-name';
  name.textContent = participant.local ? `${participant.name} (Bạn)` : participant.name;
  const mediaState = document.createElement('span');
  mediaState.className = `participant-state${participant.microphoneEnabled ? '' : ' is-off'}`;
  mediaState.textContent = participant.microphoneEnabled ? '♩' : '⊘';
  mediaState.setAttribute('aria-label', participant.microphoneEnabled ? 'Micro đang bật' : 'Micro đang tắt');
  footer.append(name, mediaState);
  tile.append(footer);

  if (tileType === 'filmstrip') {
    tile.addEventListener('click', () => {
      state.activeParticipantId = participant.id;
      getParticipants().forEach((item) => state.participants.upsert({ ...item, speaking: item.id === participant.id }));
      render();
    });
  }
  return tile;
}

function renderActiveStage() {
  const active = findParticipant(state.activeParticipantId);
  const mediaElement = document.querySelector('[data-active-media]');
  const avatar = document.querySelector('[data-active-avatar]');
  const localBadge = document.querySelector('[data-active-local]');
  const device = document.querySelector('[data-active-device]');
  const stageVideoLabel = mediaElement?.querySelector('.stage-video-label');
  if (!active || !mediaElement) return;

  mediaElement.classList.remove('stage-media-indigo', 'stage-media-amber', 'stage-media-mint', 'stage-media-camera-off');
  mediaElement.classList.add(active.cameraEnabled ? `stage-media-${active.id === 'participant-1' ? 'indigo' : active.id === 'participant-2' ? 'amber' : 'mint'}` : 'stage-media-camera-off');
  avatar.textContent = getInitials(active.name);
  setText('[data-active-name]', active.local ? `${active.name} (Bạn)` : active.name);
  setText('[data-active-role]', getParticipantRoleLabel(active.role));
  device.textContent = active.cameraEnabled
    ? active.microphoneEnabled ? 'Camera và micro đang bật' : 'Camera đang bật · Micro đang tắt'
    : active.microphoneEnabled ? 'Camera đang tắt · Micro đang bật' : 'Camera và micro đang tắt';
  localBadge.hidden = !active.local;
  if (stageVideoLabel) stageVideoLabel.textContent = active.cameraEnabled ? 'Camera đang bật' : 'Camera tắt';
}

function renderFilmstrip() {
  state.filmstripSize = getFilmstripSize();
  const participants = getParticipants();
  const pageCount = Math.max(1, Math.ceil(participants.length / state.filmstripSize));
  state.filmstripPage = Math.min(state.filmstripPage, pageCount - 1);
  const start = state.filmstripPage * state.filmstripSize;
  const visible = participants.slice(start, start + state.filmstripSize);
  filmstrip.replaceChildren(...visible.map((participant) => createParticipantTile(participant)));
  const previous = document.querySelector('[data-filmstrip-prev]');
  const next = document.querySelector('[data-filmstrip-next]');
  previous.disabled = state.filmstripPage === 0;
  next.disabled = state.filmstripPage >= pageCount - 1;
  setText('[data-filmstrip-page]', `${state.filmstripPage + 1} / ${pageCount}`);
  setText('[data-filmstrip-summary]', `Hiển thị ${start + 1}–${start + visible.length} / ${participants.length} thành viên`);
}

function renderGrid() {
  const visible = getParticipants().slice(0, 9);
  gridTiles.replaceChildren(...visible.map((participant) => createParticipantTile(participant, 'grid')));
}

function createParticipantActionMenu(participant) {
  const actions = getParticipantActions(state.role, participant);
  if (!actions.length) return null;

  const actionsWrap = document.createElement('span');
  actionsWrap.className = 'participant-row-actions';
  const menuButton = document.createElement('button');
  menuButton.className = 'participant-row-menu-button';
  menuButton.type = 'button';
  menuButton.setAttribute('aria-label', `Thao tác với ${participant.name}`);
  menuButton.setAttribute('aria-haspopup', 'menu');
  menuButton.setAttribute('aria-expanded', String(state.participantMenuId === participant.id));
  menuButton.dataset.participantMenu = participant.id;
  menuButton.textContent = '•••';
  actionsWrap.append(menuButton);

  const menu = document.createElement('div');
  menu.className = 'participant-menu';
  menu.hidden = state.participantMenuId !== participant.id;
  menu.setAttribute('role', 'menu');
  actions.forEach((action) => {
    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.setAttribute('role', 'menuitem');
    actionButton.dataset.participantAction = action.id;
    actionButton.dataset.participantId = participant.id;
    actionButton.classList.toggle('is-danger', action.danger);
    const isUnavailable = action.id === HOST_ACTIONS.MUTE && !participant.microphoneEnabled
      || action.id === HOST_ACTIONS.STOP_CAMERA && !participant.cameraEnabled;
    actionButton.disabled = isUnavailable;
    actionButton.textContent = isUnavailable
      ? action.id === HOST_ACTIONS.MUTE ? 'Micro đã tắt' : 'Camera đã tắt'
      : action.id === HOST_ACTIONS.SHARE_PERMISSION && participant.shareScreenAllowed
        ? 'Không cho phép chia sẻ màn hình'
        : action.label;
    menu.append(actionButton);
  });
  actionsWrap.append(menu);
  return actionsWrap;
}

function createParticipantRow(participant) {
  const item = document.createElement('li');
  item.className = 'participant-row';
  item.dataset.participantRow = participant.id;
  const avatar = document.createElement('span');
  avatar.className = 'participant-row-avatar';
  avatar.textContent = getInitials(participant.name);
  const copy = document.createElement('span');
  copy.className = 'participant-row-copy';
  const name = document.createElement('strong');
  name.className = 'participant-row-name';
  name.textContent = participant.local ? `${participant.name} (Bạn)` : participant.name;
  const participantRole = document.createElement('small');
  participantRole.className = `participant-row-role${participant.role === PARTICIPANT_ROLES.MEMBER ? '' : ' role-badge'}`;
  participantRole.textContent = getParticipantRoleLabel(participant.role);
  copy.append(name, participantRole);

  const mediaState = document.createElement('span');
  mediaState.className = 'participant-row-media';
  const microphoneState = document.createElement('span');
  microphoneState.className = `participant-row-state${participant.microphoneEnabled ? '' : ' is-off'}`;
  microphoneState.textContent = participant.microphoneEnabled ? '♩' : '⊘';
  microphoneState.setAttribute('aria-label', participant.microphoneEnabled ? 'Micro đang bật' : 'Micro đang tắt');
  const cameraState = document.createElement('span');
  cameraState.className = `participant-row-state${participant.cameraEnabled ? '' : ' is-off'}`;
  cameraState.textContent = participant.cameraEnabled ? '▣' : '□';
  cameraState.setAttribute('aria-label', participant.cameraEnabled ? 'Camera đang bật' : 'Camera đang tắt');
  mediaState.append(microphoneState, cameraState);

  item.append(avatar, copy, mediaState);
  if (participant.speaking) {
    const speaking = document.createElement('span');
    speaking.className = 'participant-speaking';
    speaking.textContent = 'Đang nói';
    item.append(speaking);
  }
  if (participant.handRaised) {
    const hand = document.createElement('span');
    hand.className = 'participant-hand-inline';
    hand.textContent = '✋';
    hand.setAttribute('aria-label', 'Đang giơ tay');
    item.append(hand);
  }
  if (state.screenShare.presenterId === participant.id) {
    const presenter = document.createElement('span');
    presenter.className = 'participant-presenter-inline';
    presenter.textContent = '▣';
    presenter.setAttribute('aria-label', 'Đang trình bày');
    item.append(presenter);
  }
  const actionMenu = createParticipantActionMenu(participant);
  if (actionMenu) item.append(actionMenu);
  return item;
}

function renderWaitingParticipants() {
  const list = document.querySelector('[data-waiting-list]');
  if (!list) return;
  const query = document.querySelector('[data-participant-search]')?.value ?? '';
  const matches = filterParticipants(state.waitingParticipants, query);
  list.replaceChildren(...matches.map((waitingParticipant) => {
    const item = document.createElement('li');
    item.className = 'waiting-row';
    const copy = document.createElement('div');
    copy.className = 'waiting-row-copy';
    const avatar = document.createElement('span');
    avatar.className = 'waiting-row-avatar';
    avatar.textContent = getInitials(waitingParticipant.name);
    const name = document.createElement('strong');
    name.className = 'waiting-row-name';
    name.textContent = waitingParticipant.name;
    copy.append(avatar, name);
    const actions = document.createElement('div');
    actions.className = 'waiting-row-actions';
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.dataset.waitingAction = 'approve';
    approve.dataset.waitingId = waitingParticipant.id;
    approve.textContent = 'Chấp nhận';
    const reject = document.createElement('button');
    reject.type = 'button';
    reject.dataset.waitingAction = 'reject';
    reject.dataset.waitingId = waitingParticipant.id;
    reject.textContent = 'Từ chối';
    actions.append(approve, reject);
    item.append(copy, actions);
    return item;
  }));
}

function renderParticipantsPanel() {
  const list = document.querySelector('[data-participants-list]');
  const waitingList = document.querySelector('[data-waiting-list]');
  if (!list || !waitingList) return;
  const joined = getParticipants();
  const query = document.querySelector('[data-participant-search]')?.value ?? '';
  const roleCounts = getParticipantRoleCounts(joined);
  const presenterSection = document.querySelector('[data-presenter-section]');
  const presenterList = document.querySelector('[data-presenter-list]');
  const presenter = state.screenShare.presenterId ? findParticipant(state.screenShare.presenterId) : null;
  const isJoinedTab = state.participantTab === PARTICIPANT_TABS.JOINED;
  const isWaitingTab = state.participantTab === PARTICIPANT_TABS.WAITING;
  const isHostsTab = state.participantTab === PARTICIPANT_TABS.HOSTS;

  document.querySelector('[data-participant-tab="waiting"]').hidden = !['host', 'co-host'].includes(state.role);
  document.querySelector('[data-joined-count]').textContent = String(joined.length);
  document.querySelector('[data-waiting-count]').textContent = String(state.waitingParticipants.length);
  document.querySelector('[data-host-count]').textContent = String(roleCounts.host + roleCounts.coHost);
  document.querySelectorAll('[data-participant-tab]').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.participantTab === state.participantTab));
  });

  if (presenterSection && presenterList) {
    presenterSection.hidden = !isJoinedTab || !presenter;
    presenterList.replaceChildren();
    if (presenter) {
      const row = document.createElement('li');
      row.className = 'presenter-row';
      const avatar = document.createElement('span');
      avatar.className = 'presenter-row-avatar';
      avatar.textContent = getInitials(presenter.name);
      const copy = document.createElement('span');
      copy.className = 'presenter-row-copy';
      const name = document.createElement('strong');
      name.textContent = presenter.local ? `${presenter.name} (Bạn)` : presenter.name;
      const status = document.createElement('small');
      status.textContent = 'Đang trình bày';
      copy.append(name, status);
      row.append(avatar, copy);
      presenterList.append(row);
    }
  }

  const joinedMatches = filterParticipants(joined, query).filter((participant) => !isHostsTab || ['host', 'co-host'].includes(participant.role));
  list.hidden = !isJoinedTab && !isHostsTab;
  waitingList.hidden = !isWaitingTab;
  list.replaceChildren(...joinedMatches.map(createParticipantRow));
  renderWaitingParticipants();

  const visibleCount = isWaitingTab ? filterParticipants(state.waitingParticipants, query).length : joinedMatches.length;
  const empty = document.querySelector('[data-participant-empty]');
  empty.hidden = visibleCount > 0;
  empty.textContent = isWaitingTab
    ? (state.waitingParticipants.length ? 'Không tìm thấy thành viên phù hợp.' : 'Không có ai đang chờ.')
    : (joined.length === 1 ? 'Bạn đang là người duy nhất trong cuộc họp.' : 'Không tìm thấy thành viên phù hợp.');
  setText('[data-participant-helper]', isWaitingTab ? `${state.waitingParticipants.length} yêu cầu đang chờ` : `${visibleCount} thành viên trong danh sách`);
  document.querySelector('[data-mute-all]').hidden = !['host', 'co-host'].includes(state.role) || !isJoinedTab;
  document.querySelector('[data-approve-all]').hidden = !['host', 'co-host'].includes(state.role) || !isWaitingTab || !state.waitingParticipants.length;
}

function closeParticipantMenu() {
  if (!state.participantMenuId) return false;
  state.participantMenuId = null;
  if (state.panel === 'participants') renderParticipantsPanel();
  return true;
}

function toggleParticipantMenu(participantId) {
  state.participantMenuId = state.participantMenuId === participantId ? null : participantId;
  renderParticipantsPanel();
}

function shouldFailModeration(action) {
  return scenario === 'network-error'
    || (scenario === 'promote-error' && [HOST_ACTIONS.PROMOTE, HOST_ACTIONS.DEMOTE].includes(action))
    || (scenario === 'remove-error' && action === HOST_ACTIONS.REMOVE)
    || (scenario === 'mute-all-error' && action === 'muteAll');
}

function openModerationConfirmation(action, targetId = null) {
  const target = targetId ? findParticipant(targetId) : null;
  state.pendingConfirmation = { action, targetId };
  let title = 'Xác nhận thao tác';
  let copy = 'Thao tác mock này sẽ cập nhật trạng thái trong giao diện.';
  let confirmLabel = 'Xác nhận';
  const destructive = action === HOST_ACTIONS.REMOVE || action === 'muteAll';

  if (action === HOST_ACTIONS.PROMOTE && target) {
    title = `Chỉ định ${target.name} làm đồng chủ trì?`;
    copy = 'Người này sẽ có thêm quyền quản lý người tham gia và phòng chờ.';
  }
  if (action === HOST_ACTIONS.DEMOTE && target) {
    title = `Gỡ quyền đồng chủ trì của ${target.name}?`;
    copy = 'Người này sẽ trở về vai trò thành viên.';
  }
  if (action === HOST_ACTIONS.REMOVE && target) {
    title = `Xóa ${target.name} khỏi cuộc họp?`;
    copy = 'Người này sẽ rời cuộc họp ngay lập tức.';
    confirmLabel = 'Xóa khỏi cuộc họp';
  }
  if (action === 'muteAll') {
    title = 'Tắt micro của tất cả người tham gia?';
    copy = 'Người tham gia có thể tự bật lại nếu cuộc họp cho phép.';
    confirmLabel = 'Tắt tất cả';
  }

  setText('[data-confirm-title]', title);
  setText('[data-confirm-copy]', copy);
  setText('[data-confirm-action]', confirmLabel);
  const confirmButton = document.querySelector('[data-confirm-action]');
  confirmButton.classList.toggle('button-danger', destructive);
  confirmButton.classList.toggle('button-secondary', !destructive);
  closeParticipantMenu();
  openModal('confirm');
}

function applyModerationAction(action, targetId) {
  const target = targetId ? findParticipant(targetId) : null;
  if (target && !canUseHostAction(state.role, target, action)) {
    showToast('Bạn không có quyền thực hiện thao tác này.');
    return;
  }
  if (shouldFailModeration(action)) {
    showToast(getHostActionFailureMessage(action));
    return;
  }

  if (action === HOST_ACTIONS.MUTE && target) {
    state.participants.update(target.id, { microphoneEnabled: false });
    showToast(`Đã tắt micro của ${target.name}.`);
  }
  if (action === HOST_ACTIONS.STOP_CAMERA && target) {
    state.participants.update(target.id, { cameraEnabled: false });
    showToast(`Đã tắt camera của ${target.name}.`);
  }
  if (action === HOST_ACTIONS.SHARE_PERMISSION && target) {
    const allowed = !target.shareScreenAllowed;
    state.participants.update(target.id, { shareScreenAllowed: allowed });
    showToast(allowed ? `Đã cho phép ${target.name} chia sẻ màn hình.` : `Đã tắt quyền chia sẻ màn hình của ${target.name}.`);
  }
  if (action === HOST_ACTIONS.PROMOTE && target) {
    state.participants.update(target.id, { role: PARTICIPANT_ROLES.CO_HOST });
    showToast(`${target.name} hiện là đồng chủ trì.`);
  }
  if (action === HOST_ACTIONS.DEMOTE && target) {
    state.participants.update(target.id, { role: PARTICIPANT_ROLES.MEMBER });
    showToast(`${target.name} đã trở về vai trò thành viên.`);
  }
  if (action === HOST_ACTIONS.REMOVE && target) {
    state.participants.remove(target.id);
    if (state.activeParticipantId === target.id) state.activeParticipantId = getLocalParticipant().id;
    if (state.screenShare.presenterId === target.id) stopMockRemoteShare();
    showToast(`${target.name} đã rời khỏi cuộc họp.`);
  }
  if (action === 'muteAll') {
    getParticipants().filter((participant) => !participant.local).forEach((participant) => {
      state.participants.update(participant.id, { microphoneEnabled: false });
    });
    showToast('Đã tắt micro của người tham gia.');
  }
  render();
}

function confirmPendingAction() {
  const pending = state.pendingConfirmation;
  state.pendingConfirmation = null;
  closeModal();
  if (pending) applyModerationAction(pending.action, pending.targetId);
}

function handleParticipantAction(action, participantId) {
  const target = findParticipant(participantId);
  if (!canUseHostAction(state.role, target, action)) {
    closeParticipantMenu();
    showToast('Bạn không có quyền thực hiện thao tác này.');
    return;
  }
  if ([HOST_ACTIONS.PROMOTE, HOST_ACTIONS.DEMOTE, HOST_ACTIONS.REMOVE].includes(action)) {
    openModerationConfirmation(action, participantId);
    return;
  }
  closeParticipantMenu();
  applyModerationAction(action, participantId);
}

function handleWaitingAction(action, waitingId) {
  if (!['host', 'co-host'].includes(state.role)) {
    showToast('Bạn không có quyền xử lý yêu cầu tham gia.');
    return;
  }
  if (shouldFailModeration('waiting')) {
    showToast('Không thể xử lý yêu cầu tham gia.');
    return;
  }
  const waiting = state.waitingParticipants.find((participant) => participant.id === waitingId);
  if (!waiting) return;
  state.waitingParticipants = state.waitingParticipants.filter((participant) => participant.id !== waitingId);
  if (action === 'reject') {
    showToast(`${waiting.name} đã bị từ chối vào phòng.`);
    render();
    return;
  }
  if (getParticipants().length >= MAX_PARTICIPANTS) {
    state.waitingParticipants = [...state.waitingParticipants, waiting];
    showToast('Cuộc họp đã đủ 50 người.');
    render();
    return;
  }
  // SECURITY: Production approval must re-check capacity atomically on the server.
  state.participants.upsert({
    id: `participant-${waiting.id}`,
    name: waiting.name,
    role: PARTICIPANT_ROLES.MEMBER,
    local: false,
    cameraEnabled: true,
    microphoneEnabled: true,
    speaking: false,
    handRaised: false,
    shareScreenAllowed: true
  });
  showToast(`${waiting.name} đã được chấp nhận vào phòng.`);
  render();
}

function handleApproveAll() {
  if (!['host', 'co-host'].includes(state.role)) {
    showToast('Bạn không có quyền xử lý yêu cầu tham gia.');
    return;
  }
  if (!state.waitingParticipants.length) {
    showToast('Không có ai đang chờ.');
    return;
  }
  if (shouldFailModeration('waiting')) {
    showToast('Không thể xử lý yêu cầu tham gia.');
    return;
  }

  const availableSlots = Math.max(0, MAX_PARTICIPANTS - getParticipants().length);
  const admitted = state.waitingParticipants.slice(0, availableSlots);
  const remaining = state.waitingParticipants.slice(availableSlots);
  admitted.forEach((waiting) => {
    state.participants.upsert({
      id: `participant-${waiting.id}`,
      name: waiting.name,
      role: PARTICIPANT_ROLES.MEMBER,
      local: false,
      cameraEnabled: true,
      microphoneEnabled: true,
      speaking: false,
      handRaised: false,
      shareScreenAllowed: true
    });
  });
  state.waitingParticipants = remaining;
  if (remaining.length) {
    showToast(`Đã chấp nhận ${admitted.length} người. Cuộc họp hiện đã đủ 50 người.`);
  } else {
    showToast(`Đã chấp nhận ${admitted.length} người.`);
  }
  render();
}

function handlePanelAction(action) {
  if (action === 'mute-all') openModerationConfirmation('muteAll');
  if (action === 'approve-all') handleApproveAll();
  if (action === 'invite') openModal('invite');
  if (action === 'more') showToast('Các cài đặt nâng cao sẽ được bổ sung sau.');
}

function renderPanel() {
  const panelName = state.panel;
  panel.hidden = !panelName;
  app.classList.toggle('has-panel', Boolean(panelName));
  document.querySelectorAll('[data-panel-content]').forEach((content) => {
    content.hidden = content.dataset.panelContent !== panelName;
  });
  document.querySelectorAll('[data-panel-trigger]').forEach((button) => {
    button.setAttribute('aria-expanded', String(button.dataset.panelTrigger === panelName));
  });
  if (!panelName) return;

  const titles = { chat: 'Trò chuyện', participants: `Thành viên (${getParticipants().length} / ${MAX_PARTICIPANTS})`, info: 'Thông tin cuộc họp' };
  setText('[data-panel-title]', titles[panelName]);
  setText('[data-panel-eyebrow]', panelName === 'info' ? 'Chi tiết phòng' : 'Trong cuộc họp');
  if (panelName === 'participants') renderParticipantsPanel();
  if (panelName === 'chat') renderChat();
  if (panelName === 'info') renderMeetingInfo();
}

function renderChat() {
  const list = document.querySelector('[data-chat-list]');
  if (!list) return;
  list.replaceChildren();
  state.messages.forEach((message) => appendChatMessage(list, message));
}

function renderMeetingInfo() {
  setText('[data-info-title]', state.meetingTitle);
  setText('[data-info-room]', state.roomCode);
  setText('[data-info-host]', state.hostName);
  setText('[data-info-started]', new Date(state.startedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
}

function renderMediaControls() {
  const local = getLocalParticipant();
  const microphoneButton = document.querySelector('[data-toolbar-action="microphone"]');
  const cameraButton = document.querySelector('[data-toolbar-action="camera"]');
  [
    [microphoneButton, 'microphone', local.microphoneEnabled],
    [cameraButton, 'camera', local.cameraEnabled]
  ].forEach(([button, kind, enabled]) => {
    if (!button) return;
    button.classList.toggle('is-on', enabled);
    button.classList.toggle('is-off', !enabled);
    button.setAttribute('aria-pressed', String(enabled));
    setText(`[data-toolbar-state="${kind}"]`, enabled ? 'Đang bật' : 'Đang tắt');
  });
  setText('[data-member-label]', `${getParticipants().length} người`);
  setText('[data-participant-count]', getParticipants().length);
}

function renderView() {
  if (state.screenShare.active) {
    stage.hidden = true;
    gridTiles.hidden = true;
    presentationStage.hidden = false;
    renderPresentation();
    return;
  }

  const speakerMode = state.view === 'speaker';
  page.dataset.meetingMode = 'normal';
  presentationStage.hidden = true;
  presentationVideo.pause();
  presentationVideo.srcObject = null;
  presentationVideo.hidden = true;
  remoteSharePlaceholder.hidden = true;
  presentationEmpty.hidden = true;
  document.querySelector('[data-stop-presentation]').hidden = true;
  stage.hidden = !speakerMode;
  gridTiles.hidden = speakerMode;
  const shareButton = document.querySelector('[data-toolbar-action="share"]');
  shareButton.classList.remove('is-sharing');
  shareButton.setAttribute('aria-pressed', 'false');
  setText('[data-share-label]', 'Chia sẻ');
  setText('[data-share-state]', 'Màn hình');
  setText('[data-stage-heading]', speakerMode ? 'Người đang phát biểu' : 'Lưới thành viên');
  setText('[data-stage-status]', speakerMode ? 'Chế độ người nói' : 'Chế độ lưới');
  if (!speakerMode) renderGrid();
}

function renderPresentation() {
  const presenter = findParticipant(state.screenShare.presenterId);
  const localPresenter = state.screenShare.isLocalPresenter;
  const shareButton = document.querySelector('[data-toolbar-action="share"]');
  const stopButton = document.querySelector('[data-stop-presentation]');
  const video = presentationVideo;

  page.dataset.meetingMode = 'presentation';
  setText('[data-stage-heading]', 'Màn hình đang được chia sẻ');
  setText('[data-stage-status]', 'Chế độ trình bày');
  setText('[data-presentation-banner]', localPresenter ? 'Bạn đang trình bày màn hình' : `${presenter?.name || 'Thành viên'} đang trình bày`);
  setText('[data-remote-share-title]', `${presenter?.name || 'Thành viên'} đang trình bày`);
  setText('[data-remote-share-topic]', 'Nội dung đang được trình bày trong cuộc họp');
  stopButton.hidden = !localPresenter;
  shareButton.classList.toggle('is-sharing', localPresenter);
  shareButton.setAttribute('aria-pressed', String(localPresenter));
  setText('[data-share-label]', localPresenter ? 'Dừng chia sẻ' : 'Chia sẻ');
  setText('[data-share-state]', localPresenter ? 'Đang trình bày' : 'Đang có người trình bày');

  if (localPresenter && state.screenShare.stream) {
    remoteSharePlaceholder.hidden = true;
    presentationEmpty.hidden = true;
    video.hidden = false;
    if (video.srcObject !== state.screenShare.stream) {
      video.srcObject = state.screenShare.stream;
      video.play().catch(() => {});
    }
    return;
  }

  video.pause();
  video.srcObject = null;
  video.hidden = true;
  remoteSharePlaceholder.hidden = !presenter;
  presentationEmpty.hidden = Boolean(presenter);
}

function render() {
  renderActiveStage();
  renderFilmstrip();
  renderView();
  renderPanel();
  renderMediaControls();
  const unread = document.querySelector('[data-chat-unread]');
  unread.hidden = state.unreadCount < 1;
  if (!unread.hidden) unread.textContent = String(state.unreadCount);
  setText('[data-raise-hand-label]', getLocalParticipant().handRaised ? 'Hạ tay' : 'Giơ tay');
}

function setPanel(panelName) {
  state.panel = state.panel === panelName ? null : panelName;
  if (state.panel !== 'participants') state.participantMenuId = null;
  if (state.panel === 'chat') {
    state.unreadCount = 0;
    document.querySelector('[data-chat-unread]').hidden = true;
  }
  closeMoreMenu();
  render();
}

function closePanel() {
  state.panel = null;
  state.participantMenuId = null;
  render();
}

function closeMoreMenu() {
  const menu = document.querySelector('[data-more-menu]');
  const toggle = document.querySelector('[data-more-toggle]');
  menu.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
}

function toggleMoreMenu() {
  const menu = document.querySelector('[data-more-menu]');
  const toggle = document.querySelector('[data-more-toggle]');
  const nextOpen = menu.hidden;
  document.querySelector('[data-reaction-popover]').hidden = true;
  menu.hidden = !nextOpen;
  toggle.setAttribute('aria-expanded', String(nextOpen));
}

function toggleReactionPopover() {
  const popover = document.querySelector('[data-reaction-popover]');
  closeMoreMenu();
  popover.hidden = !popover.hidden;
  document.querySelector('[data-reaction-toggle]').setAttribute('aria-expanded', String(!popover.hidden));
}

function showToast(message) {
  const toast = document.querySelector('[data-toast]');
  window.clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  state.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2800);
}

function getMeetingLink() {
  const link = new URL(getPageUrl('join-meeting.html'), window.location.href);
  link.searchParams.set('room', state.roomCode);
  return link.href;
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(successMessage);
  } catch {
    showToast('Không thể sao chép tự động. Hãy thử lại trên trình duyệt được hỗ trợ.');
  }
}

function updateInviteDialog() {
  setText('[data-invite-room]', state.roomCode);
  setText('[data-invite-link]', getMeetingLink());
  const capacityNote = document.querySelector('[data-invite-capacity]');
  if (getParticipants().length >= MAX_PARTICIPANTS) {
    capacityNote.hidden = false;
    capacityNote.textContent = 'Cuộc họp hiện đã đủ 50 người. Người mới có thể không vào được phòng.';
  } else {
    capacityNote.hidden = true;
  }
}

function openModal(name) {
  const layer = document.querySelector('[data-modal-layer]');
  document.querySelectorAll('[data-dialog]').forEach((dialog) => { dialog.hidden = dialog.dataset.dialog !== name; });
  layer.hidden = false;
  if (name === 'invite') updateInviteDialog();
  if (name === 'leave') {
    const host = state.role === 'host';
    document.querySelector('[data-leave-action="end"]')?.toggleAttribute('hidden', !host);
    setText('[data-leave-copy]', host ? 'Bạn có thể rời phòng hoặc kết thúc cuộc họp cho tất cả thành viên.' : 'Bạn có thể rời cuộc họp mà không ảnh hưởng đến những người còn lại.');
  }
}

function closeModal() {
  state.pendingConfirmation = null;
  document.querySelector('[data-modal-layer]').hidden = true;
}

function toggleLocalMedia(kind) {
  const local = getLocalParticipant();
  const enabled = kind === 'microphone' ? media.toggleMicrophone() : media.toggleCamera();
  state.participants.upsert({ ...local, [`${kind}Enabled`]: enabled });
  render();
}

async function handleShare() {
  if (state.screenShare.active) {
    if (state.screenShare.isLocalPresenter) {
      await stopScreenShare();
    } else {
      showToast('Hiện đang có người trình bày.');
    }
    return;
  }

  const shareButton = document.querySelector('[data-toolbar-action="share"]');
  shareButton.disabled = true;
  setText('[data-share-label]', 'Đang mở…');
  setText('[data-share-state]', 'Chọn nguồn');
  const result = await startScreenShare();
  shareButton.disabled = false;
  if (!state.screenShare.active) render();
  if (result.started || result.reason === 'CANCELLED') return;
  if (result.reason === 'REMOTE_ACTIVE') {
    showToast('Hiện đang có người trình bày.');
    return;
  }
  if (result.reason === 'UNSUPPORTED') {
    showToast('Trình duyệt này chưa hỗ trợ chia sẻ màn hình.');
    return;
  }
  if (result.reason === 'DENIED') {
    showToast('Quyền chia sẻ màn hình chưa được cấp.');
    return;
  }
  showToast(result.reason === 'SOURCE_BUSY' ? 'Không thể sử dụng nguồn chia sẻ này.' : 'Không thể bắt đầu chia sẻ màn hình.');
}

async function handleStopPresentation() {
  if (!state.screenShare.isLocalPresenter) return;
  await stopScreenShare();
}

function handleReaction(reaction) {
  showToast(`Bạn đã gửi ${reaction}`);
  document.querySelector('[data-reaction-popover]').hidden = true;
  document.querySelector('[data-reaction-toggle]').setAttribute('aria-expanded', 'false');
}

function toggleRaiseHand() {
  const local = getLocalParticipant();
  state.participants.upsert({ ...local, handRaised: !local.handRaised });
  showToast(local.handRaised ? 'Bạn đã hạ tay.' : 'Bạn đã giơ tay.');
  render();
}

function setView(view) {
  state.view = view;
  page.dataset.viewMode = view;
  closeMoreMenu();
  render();
  showToast(view === 'grid' ? 'Đã chuyển sang chế độ lưới.' : 'Đã chuyển sang chế độ người nói.');
}

function setConnection(connectionState, label) {
  const indicator = document.querySelector('[data-connection-indicator]');
  indicator.dataset.state = connectionState;
  setText('[data-connection-label]', label);
}

function startConnectionMock() {
  if (scenario === 'reconnecting') {
    setConnection('reconnecting', 'Đang kết nối lại…');
    state.reconnectTimer = window.setTimeout(() => setConnection('good', 'Kết nối tốt'), 3500);
  } else if (scenario === 'degraded') {
    setConnection('degraded', 'Kết nối không ổn định');
  }
}

function startActiveSpeakerMock() {
  if (scenario !== 'active-speaker-change') return;
  state.speakerTimer = window.setInterval(() => {
    const participants = getParticipants().filter((participant) => !participant.local);
    const currentIndex = participants.findIndex((participant) => participant.id === state.activeParticipantId);
    const next = participants[(currentIndex + 1) % participants.length];
    state.activeParticipantId = next?.id || 'local';
    state.participants.list().forEach((participant) => state.participants.upsert({ ...participant, speaking: participant.id === state.activeParticipantId }));
    render();
  }, 9000);
}

function handleChatSubmit(event) {
  event.preventDefault();
  const input = event.currentTarget.elements.message;
  const content = String(input.value ?? '').trim();
  if (!content) return;
  state.messages.push({ author: state.displayName, content });
  input.value = '';
  renderChat();
  input.focus();
}

function handleParticipantSearch() {
  if (state.panel === 'participants') renderParticipantsPanel();
}

function handleScreenShareState(nextState) {
  state.screenShare = {
    active: Boolean(nextState.active),
    presenterId: nextState.presenterId,
    isLocalPresenter: Boolean(nextState.isLocalPresenter),
    stream: nextState.stream || null
  };
  render();
}

function cleanup() {
  window.clearInterval(state.timer);
  window.clearInterval(state.speakerTimer);
  window.clearTimeout(state.reconnectTimer);
  window.clearTimeout(state.toastTimer);
  state.timer = 0;
  state.speakerTimer = 0;
  state.reconnectTimer = 0;
  state.toastTimer = 0;
  try { state.unsubscribeScreenShare?.(); } catch { /* Runtime cleanup is best effort. */ }
  state.unsubscribeScreenShare = null;
  try { cleanupScreenShare(); } catch { /* Runtime cleanup is best effort. */ }
  try { media.stop?.(); } catch { /* Runtime cleanup is best effort. */ }
}

// SECURITY: Ending a meeting for everyone must be authorized by trusted server logic; client role is UI-only.
function leaveMeeting(endForEveryone = false) {
  if (page.dataset.meetingState === 'leaving') return;
  const shouldEndForEveryone = Boolean(endForEveryone && state.role === PARTICIPANT_ROLES.HOST);
  const leftAt = Date.now();
  const durationSeconds = Math.max(0, Math.floor((leftAt - state.startedAt) / 1000));
  const leaveResult = {
    meetingTitle: String(state.meetingTitle || 'Cuộc họp FLASH MEETING'),
    roomCode: String(state.roomCode || ''),
    reason: shouldEndForEveryone ? 'ENDED_FOR_ALL' : 'LEFT',
    joinedAt: state.startedAt,
    leftAt,
    durationSeconds
  };

  closeModal();
  page.dataset.meetingState = 'leaving';
  document.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  showToast(shouldEndForEveryone ? 'Đang kết thúc cuộc họp cho tất cả…' : 'Đang rời cuộc họp…');
  cleanup();
  writeSession('flashMeeting.leaveResult', JSON.stringify(leaveResult));
  window.setTimeout(() => { window.location.href = getPageUrl('meeting-ended.html'); }, 260);
}

function bindEvents() {
  document.querySelectorAll('[data-toolbar-action]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.toolbarAction === 'microphone' || button.dataset.toolbarAction === 'camera') toggleLocalMedia(button.dataset.toolbarAction);
      if (button.dataset.toolbarAction === 'share') handleShare();
    });
  });
  document.querySelectorAll('[data-panel-trigger]').forEach((button) => button.addEventListener('click', () => setPanel(button.dataset.panelTrigger)));
  document.querySelector('[data-close-panel]')?.addEventListener('click', closePanel);
  document.querySelector('[data-more-toggle]')?.addEventListener('click', toggleMoreMenu);
  document.querySelectorAll('[data-more-action]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.moreAction === 'info') setPanel('info');
    if (button.dataset.moreAction === 'grid') setView('grid');
    if (button.dataset.moreAction === 'speaker') setView('speaker');
    if (button.dataset.moreAction === 'devices') { closeMoreMenu(); showToast('Thiết lập thiết bị sẽ dùng lại lựa chọn từ bước Pre-Join.'); }
  }));
  document.querySelector('[data-reaction-toggle]')?.addEventListener('click', toggleReactionPopover);
  document.querySelectorAll('[data-reaction]').forEach((button) => button.addEventListener('click', () => handleReaction(button.dataset.reaction)));
  document.querySelector('[data-raise-hand]')?.addEventListener('click', toggleRaiseHand);
  document.querySelector('[data-stop-presentation]')?.addEventListener('click', handleStopPresentation);
  panel.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-participant-tab]');
    if (tab) {
      state.participantTab = tab.dataset.participantTab;
      state.participantMenuId = null;
      renderParticipantsPanel();
      return;
    }
    const menuButton = event.target.closest('[data-participant-menu]');
    if (menuButton) {
      toggleParticipantMenu(menuButton.dataset.participantMenu);
      return;
    }
    const participantAction = event.target.closest('[data-participant-action]');
    if (participantAction) {
      handleParticipantAction(participantAction.dataset.participantAction, participantAction.dataset.participantId);
      return;
    }
    const waitingAction = event.target.closest('[data-waiting-action]');
    if (waitingAction) {
      handleWaitingAction(waitingAction.dataset.waitingAction, waitingAction.dataset.waitingId);
      return;
    }
    const panelAction = event.target.closest('[data-panel-action]');
    if (panelAction) handlePanelAction(panelAction.dataset.panelAction);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.participant-menu') && !event.target.closest('[data-participant-menu]')) closeParticipantMenu();
  });
  document.querySelector('[data-filmstrip-prev]')?.addEventListener('click', () => { state.filmstripPage -= 1; renderFilmstrip(); });
  document.querySelector('[data-filmstrip-next]')?.addEventListener('click', () => { state.filmstripPage += 1; renderFilmstrip(); });
  document.querySelector('[data-chat-form]')?.addEventListener('submit', handleChatSubmit);
  document.querySelector('[data-participant-search]')?.addEventListener('input', handleParticipantSearch);
  document.querySelector('[data-open-invite]')?.addEventListener('click', () => openModal('invite'));
  document.querySelector('[data-leave-meeting]')?.addEventListener('click', () => openModal('leave'));
  document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
  document.querySelector('[data-confirm-action]')?.addEventListener('click', confirmPendingAction);
  document.querySelector('[data-leave-action="leave"]')?.addEventListener('click', () => leaveMeeting(false));
  document.querySelector('[data-leave-action="end"]')?.addEventListener('click', () => leaveMeeting(true));
  document.querySelectorAll('[data-copy-room]').forEach((button) => button.addEventListener('click', () => copyText(state.roomCode, 'Đã sao chép mã phòng.')));
  document.querySelectorAll('[data-copy-link]').forEach((button) => button.addEventListener('click', () => copyText(getMeetingLink(), 'Đã sao chép liên kết cuộc họp.')));
  window.addEventListener('resize', () => renderFilmstrip());
  window.addEventListener('beforeunload', cleanup, { once: true });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (closeParticipantMenu()) return;
    closeMoreMenu();
    document.querySelector('[data-reaction-popover]').hidden = true;
    if (!document.querySelector('[data-modal-layer]').hidden) closeModal();
    if (state.panel) closePanel();
  });
}

function initialize() {
  state.participants = createParticipants();
  state.waitingParticipants = createWaitingParticipants();
  state.unsubscribeScreenShare = subscribeScreenShare(handleScreenShareState);
  const local = getLocalParticipant();
  if (!local.microphoneEnabled) media.toggleMicrophone();
  if (!local.cameraEnabled) media.toggleCamera();
  state.activeParticipantId = getParticipants().find((participant) => participant.speaking)?.id || local.id;
  page.dataset.meetingState = 'connected';
  setText('[data-meeting-title]', state.meetingTitle);
  setText('[data-room-code]', state.roomCode);
  setText('[data-capacity]', MAX_PARTICIPANTS);
  setText('[data-info-host]', state.hostName);
  document.querySelector('[data-toolbar-action="share"]')?.setAttribute('data-share-supported', String(isScreenShareSupported()));
  bindEvents();
  render();
  updateDuration();
  state.timer = window.setInterval(updateDuration, 1000);
  startConnectionMock();
  startActiveSpeakerMock();
  if (isRemoteShareScenario()) {
    const presenter = findParticipant('participant-1');
    startMockRemoteShare({ id: presenter.id, name: presenter.name });
  }
  if (scenario === 'meeting-ended' || scenario === 'removed') {
    page.dataset.meetingState = scenario === 'removed' ? 'removed' : 'meeting-ended';
    showToast(scenario === 'removed' ? 'Bạn đã được rời khỏi cuộc họp.' : 'Cuộc họp đã kết thúc.');
  } else {
    page.dataset.meetingState = 'normal';
  }
}

initialize();
