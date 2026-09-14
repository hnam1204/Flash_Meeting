import { appendChatMessage } from './meeting-chat.js';
import {
  createMediaController,
  getMediaPreferences,
  saveMediaPreferences
} from './meeting-media.js';
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
  getLiveScreenTrack,
  getScreenShareState,
  isScreenShareSupported,
  isScreenShareHealthy,
  SCREEN_SHARE_STATES,
  startMockRemoteShare,
  startScreenShare,
  stopScreenShare,
  stopMockRemoteShare,
  subscribeScreenShare
} from './meeting-screen-share.js';
import { authService } from './auth-service.js';
import {
  END_MEETING_ERROR_CODES,
  MAX_MEETING_PARTICIPANTS,
  MEETING_STATUSES,
  meetingService,
  subscribeMeetingEvents
} from './meeting-service.js';
import { getPageUrl } from './utils.js';
import { protectPage, registerAuthExpiryCleanup, revalidateSessionSilently } from './auth-guard.js';
import { createMeetingRecordingController, RECORDING_STATES } from './meeting-recording.js';
import { copyToClipboard, createMeetingInviteController } from './meeting-invite.js';
import { createLiveKitRoomController } from './livekit-room-controller.js';
import {
  createMeetingRealtimeController,
  getMeetingSessionId,
  normalizeRealtimeParticipant,
  normalizeRealtimeMessage,
  requestLiveKitToken
} from './meeting-realtime.js';
import { modal } from './ui/modal-manager.js';
import { createIcon, renderIcons, setIcon } from './ui/icons.js';
import { createParticipantGridController } from './meeting-participant-grid.js';

const MAX_PARTICIPANTS = MAX_MEETING_PARTICIPANTS;
const DEFAULT_DURATION_SECONDS = (24 * 60) + 17;
const MEDIA_STATUS = Object.freeze({
  IDLE: 'IDLE',
  REQUESTING: 'REQUESTING',
  LIVE: 'LIVE',
  OFF: 'OFF',
  RECOVERING: 'RECOVERING',
  DENIED: 'DENIED',
  UNAVAILABLE: 'UNAVAILABLE',
  ERROR: 'ERROR'
});
const ALLOWED_REACTIONS = new Set(['👍', '❤️', '😂', '🎉', '👏', '😮']);

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

const query = new URLSearchParams(window.location.search);
const scenario = String(query.get('mock') ?? '').toLowerCase();
const isDemoMode = query.get('demo') === '1' || Boolean(scenario);
let meetingContext = meetingService.getCurrentParticipantContext(getRoomCode());
let role = meetingContext.role || PARTICIPANT_ROLES.MEMBER;
const mediaPreferences = getMediaPreferences();
const media = createMediaController(mediaPreferences);
const page = document.body;
const app = document.querySelector('.meeting-app');
const panel = document.querySelector('[data-side-panel]');
const filmstrip = document.querySelector('[data-filmstrip]');

renderIcons();
const gridTiles = document.querySelector('[data-grid-tiles]');
const stage = document.querySelector('[data-stage-view="speaker"]');
const presentationStage = document.querySelector('[data-presentation-stage]');
const presentationVideo = document.querySelector('[data-screen-share-video]');
const remoteSharePlaceholder = document.querySelector('[data-remote-share-placeholder]');
const presentationEmpty = document.querySelector('[data-presentation-empty]');
const stageModeStatus = document.querySelector('[data-stage-status]');
const presentationStatusIcon = document.querySelector('[data-presentation-status-icon]');
const state = {
  roomCode: getRoomCode(),
  meetingTitle: getMeetingTitle(),
  displayName: getStoredDisplayName(),
  hostName: meetingContext.meeting?.hostName || 'Chủ phòng',
  startedAt: getStartedAt(),
  role,
  panel: null,
  participantTab: PARTICIPANT_TABS.JOINED,
  participantMenuId: null,
  waitingParticipants: [],
  view: 'speaker',
  userSelectedView: false,
  filmstripPage: 0,
  activeParticipantId: 'local',
  messages: isDemoMode ? [
    { author: 'Minh Anh', content: 'Mọi người nghe rõ không?' },
    { author: 'Quang Huy', content: 'Mình nghe rõ, bắt đầu nhé.' },
    { author: 'Lan Chi', content: 'Mình đã mở tài liệu rồi.' }
  ] : [],
  unreadCount: scenario === 'chat-unread' ? 3 : 0,
  toastTimer: 0,
  timer: 0,
  speakerTimer: 0,
  reconnectTimer: 0,
  moderationActionInFlight: false,
  recordingActionInFlight: false,
  leaveActionInFlight: false,
  resumePromise: null,
  cleanupPromise: null,
  isCleaningUp: false,
  deviceChangeBound: false,
  unsubscribeMeetingEvents: null,
  meetingRealtime: null,
  liveKit: null,
  meetingId: meetingContext.meeting?.id || getStoredJoinedMeeting()?.id || '',
  sessionId: getMeetingSessionId(),
  participantId: '',
  liveKitConnected: false,
  liveKitParticipantsHydrated: false,
  initialLiveKitParticipantKeys: new Set(),
  realtimeParticipantsHydrated: false,
  localParticipantIdentity: '',
  meetingEndHandled: false,
  recording: {
    status: RECORDING_STATES.IDLE,
    startedAt: 0,
    duration: 0,
    mimeType: '',
    hasReadyRecording: false,
    filename: '',
    errorMessage: ''
  },
  screenShare: {
    active: false,
    presenterId: null,
    isLocalPresenter: false,
    stream: null,
    track: null,
    settings: null,
    status: SCREEN_SHARE_STATES.IDLE
  },
  localMedia: {
    cameraEnabled: mediaPreferences.cameraEnabled,
    microphoneEnabled: mediaPreferences.micEnabled,
    cameraPreference: mediaPreferences.cameraEnabled,
    microphonePreference: mediaPreferences.micEnabled,
    cameraStatus: 'IDLE',
    microphoneStatus: 'IDLE',
    isScreenSharing: false,
    cameraStream: null,
    microphoneStream: null,
    cameraDeviceId: mediaPreferences.cameraDeviceId,
    micDeviceId: mediaPreferences.micDeviceId,
    cameraSupported: false,
    microphoneSupported: false,
    cameraAvailable: true,
    microphoneAvailable: true
  },
  unsubscribeScreenShare: null,
  participants: null
};

const recordingController = createMeetingRecordingController({
  roomCode: state.roomCode,
  getScene: () => {
    const local = state.participants ? getLocalParticipant() : null;
    return {
      roomCode: state.roomCode,
      meetingTitle: state.meetingTitle,
      displayName: local?.name || state.displayName,
      initials: getInitials(local?.name || state.displayName),
      cameraEnabled: Boolean(local?.cameraEnabled && state.localMedia.cameraStream),
      cameraStream: state.localMedia.cameraStream,
      microphoneStream: state.localMedia.microphoneStream,
      presentation: Boolean(state.screenShare.active),
      screenStream: state.screenShare.isLocalPresenter ? state.screenShare.stream : null
    };
  },
  onStateChange: handleRecordingState
});

const inviteController = createMeetingInviteController({
  getMeeting: () => {
    const meeting = meetingContext?.meeting || getStoredJoinedMeeting() || {};
    return {
      ...meeting,
      title: meeting.title || state.meetingTitle,
      roomCode: meeting.roomCode || state.roomCode,
      maxParticipants: meeting.maxParticipants || MAX_PARTICIPANTS
    };
  },
  getParticipantCount: () => state.participants ? getParticipants().length : null
});

const participantGrid = createParticipantGridController({
  gridElement: gridTiles,
  filmstripElement: filmstrip,
  paginationWrap: document.querySelector('.filmstrip-wrap'),
  previousButton: document.querySelector('[data-filmstrip-prev]'),
  nextButton: document.querySelector('[data-filmstrip-next]'),
  pageIndicator: document.querySelector('[data-filmstrip-page]'),
  summaryElement: document.querySelector('[data-filmstrip-summary]'),
  getParticipants: () => state.participants ? getParticipants() : [],
  getLocalStream: () => state.localMedia.cameraStream,
  getLiveKit: () => state.liveKit,
  getActiveParticipantId: () => state.activeParticipantId,
  getPresenterId: () => state.screenShare.presenterId,
  onSelectParticipant: (participantId) => {
    if (!participantId) return;
    state.activeParticipantId = participantId;
    render();
  }
});

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
  return getStoredJoinedMeeting()?.title || 'Cuộc họp nhóm sản phẩm';
}

function getStoredJoinedMeeting() {
  try {
    const storedMeeting = JSON.parse(readSession('flashMeeting.joinedMeeting') || 'null');
    return storedMeeting && typeof storedMeeting === 'object' ? storedMeeting : null;
  } catch {
    return null;
  }
}

function getStoredDisplayName() {
  return authService.getSession()?.displayName?.trim() || readSession('flashMeeting.displayName').trim() || 'Khách tham gia';
}

function getStartedAt() {
  const toTimestamp = (value) => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const storedMeetingStartedAt = (() => {
    try {
      const storedMeeting = JSON.parse(readSession('flashMeeting.joinedMeeting') || 'null');
      return toTimestamp(storedMeeting?.startedAt);
    } catch {
      return 0;
    }
  })();
  const contextStartedAt = toTimestamp(meetingContext.meeting?.startedAt);
  if (Number.isFinite(storedMeetingStartedAt) && storedMeetingStartedAt > 0) return storedMeetingStartedAt;
  if (Number.isFinite(contextStartedAt) && contextStartedAt > 0) return contextStartedAt;
  if (!isDemoMode) return 0;

  const mockStartedAt = Date.now() - (DEFAULT_DURATION_SECONDS * 1000);
  writeSession('flashMeeting.startedAt', String(mockStartedAt));
  return mockStartedAt;
}

function getParticipantCount() {
  if (scenario === 'only-local') return 1;
  if (scenario === 'many-participants' || scenario === 'room-full' || scenario === 'full') return MAX_PARTICIPANTS;
  const countMatch = scenario.match(/^(?:participants?|users?)[-_]?(\d+)$|^(\d+)[-_]?(?:participants?|users?)$/);
  if (countMatch) return Math.max(1, Math.min(MAX_PARTICIPANTS, Number(countMatch[1] || countMatch[2])));
  return isDemoMode ? 24 : 1;
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
  const count = isDemoMode ? getParticipantCount() : 1;
  let storedParticipant = null;
  try { storedParticipant = JSON.parse(readSession('flashMeeting.joinedParticipant') || 'null'); } catch { storedParticipant = null; }
  const localCameraEnabled = isDemoMode ? scenario !== 'camera-off' : state.localMedia.cameraPreference;
  const localMicrophoneEnabled = isDemoMode ? scenario !== 'mic-off' : state.localMedia.microphonePreference;
  const local = {
    id: storedParticipant?.id || 'local',
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

function handleRecordingState(nextState) {
  state.recording = {
    ...state.recording,
    status: nextState.status,
    startedAt: nextState.startedAt,
    duration: nextState.duration,
    mimeType: nextState.mimeType,
    hasReadyRecording: nextState.hasReadyRecording,
    filename: nextState.filename,
    errorMessage: nextState.errorMessage
  };
  updateRecordingUi();
  if (nextState.status === RECORDING_STATES.ERROR && nextState.errorMessage && !state.recordingActionInFlight && !state.isCleaningUp) {
    modal.error({ title: 'Không thể hoàn tất bản ghi', message: nextState.errorMessage });
  }
}

function updateRecordingUi() {
  const indicator = document.querySelector('[data-recording-indicator]');
  const control = document.querySelector('[data-recording-control]');
  const saveControl = document.querySelector('[data-recording-toolbar-save]');
  const isHost = state.role === PARTICIPANT_ROLES.HOST;
  const isActive = [RECORDING_STATES.STARTING, RECORDING_STATES.RECORDING, RECORDING_STATES.STOPPING].includes(state.recording.status);
  const supported = recordingController.isSupported();

  if (indicator) {
    indicator.hidden = !isHost || !isActive;
    setText('[data-recording-label]', `REC ${formatDuration(state.recording.duration)}`);
  }
  if (control) {
    control.hidden = !isHost;
    control.disabled = !supported || [RECORDING_STATES.STARTING, RECORDING_STATES.STOPPING].includes(state.recording.status);
    control.classList.toggle('is-recording', isActive);
    control.classList.toggle('is-starting', state.recording.status === RECORDING_STATES.STARTING);
    control.classList.toggle('is-stopping', state.recording.status === RECORDING_STATES.STOPPING);
    control.setAttribute('aria-pressed', String(isActive));
    control.setAttribute('aria-label', supported ? (isActive ? 'Dừng ghi hình' : 'Bắt đầu ghi hình') : 'Ghi hình không khả dụng trên thiết bị này');
    setText('[data-recording-control-label]', isActive ? 'Dừng ghi' : 'Ghi hình');
    setText('[data-recording-control-state]', !supported ? 'Không khả dụng' : isActive ? 'Đang ghi' : 'Trên máy này');
    setIcon(document.querySelector('[data-recording-icon]'), isActive ? 'square' : 'circle');
    if (!supported) control.title = 'Trình duyệt này chưa hỗ trợ ghi hình cuộc họp.';
    else control.removeAttribute('title');
  }
  if (saveControl) {
    saveControl.hidden = !isHost || !state.recording.hasReadyRecording;
  }
}

function getLiveTrack(stream, kind) {
  const track = kind === 'audio'
    ? stream?.getAudioTracks?.()[0]
    : stream?.getVideoTracks?.()[0];
  return track?.readyState === 'live' ? track : null;
}

function getLiveCameraTrack() {
  return getLiveTrack(state.localMedia.cameraStream, 'video');
}

function getLiveMicrophoneTrack() {
  return getLiveTrack(state.localMedia.microphoneStream, 'audio');
}

function isCameraStreamHealthy() {
  return Boolean(getLiveCameraTrack());
}

function isMicrophoneStreamHealthy() {
  return Boolean(getLiveMicrophoneTrack());
}

function syncLocalParticipant() {
  const local = getLocalParticipant();
  if (!local) return;
  state.participants.update(local.id, {
    cameraEnabled: state.localMedia.cameraEnabled,
    microphoneEnabled: state.localMedia.microphoneEnabled
  });
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const remainder = String(seconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${remainder}`;
}

function updateDuration() {
  const elapsedSeconds = state.startedAt > 0 ? (Date.now() - state.startedAt) / 1000 : 0;
  setText('[data-meeting-duration]', formatDuration(elapsedSeconds));
  updateRecordingUi();
}

function isMeetingTransitioning() {
  return ['leaving', 'ending', 'ended'].includes(page.dataset.meetingState);
}

function renderActiveStage() {
  const active = findParticipant(state.activeParticipantId);
  const mediaElement = document.querySelector('[data-active-media]');
  const avatar = document.querySelector('[data-active-avatar]');
  const localBadge = document.querySelector('[data-active-local]');
  const device = document.querySelector('[data-active-device]');
  const localVideo = document.querySelector('[data-local-stage-video]');
  const stageVideoLabel = mediaElement?.querySelector('.stage-video-label');
  const speakingPill = document.querySelector('.speaking-pill');
  if (!active || !mediaElement) return;

  mediaElement.classList.remove('stage-media-indigo', 'stage-media-amber', 'stage-media-mint', 'stage-media-camera-off');
  mediaElement.classList.add(active.cameraEnabled ? `stage-media-${active.id === 'participant-1' ? 'indigo' : active.id === 'participant-2' ? 'amber' : 'mint'}` : 'stage-media-camera-off');
  const showLocalVideo = Boolean(active.local && active.cameraEnabled && isCameraStreamHealthy() && localVideo);
  const showRemoteVideo = Boolean(!active.local && active.cameraEnabled && active.cameraTrack && active.livekitIdentity && state.liveKit && localVideo);
  mediaElement.classList.toggle('has-live-video', showLocalVideo || showRemoteVideo);
  mediaElement.classList.toggle('is-remote-video', showRemoteVideo);
  if (localVideo) {
    localVideo.hidden = !showLocalVideo && !showRemoteVideo;
    localVideo.muted = true;
    if (showLocalVideo && localVideo.srcObject !== state.localMedia.cameraStream) {
      localVideo.srcObject = state.localMedia.cameraStream;
      localVideo.play().catch(() => {});
    }
    if (showRemoteVideo) {
      localVideo.srcObject = null;
      state.liveKit.attachRemoteTrack(active.livekitIdentity, 'camera', localVideo);
    }
    if (!showLocalVideo && !showRemoteVideo) localVideo.srcObject = null;
  }
  avatar.hidden = showLocalVideo || showRemoteVideo;
  avatar.textContent = getInitials(active.name);
  setText('[data-active-name]', active.local ? `${active.name} (Bạn)` : active.name);
  setText('[data-active-role]', getParticipantRoleLabel(active.role));
  device.textContent = active.cameraEnabled
    ? active.microphoneEnabled ? 'Camera và micro đang bật' : 'Camera đang bật · Micro đang tắt'
    : active.microphoneEnabled ? 'Camera đang tắt · Micro đang bật' : 'Camera và micro đang tắt';
  localBadge.hidden = !active.local;
  if (speakingPill) speakingPill.hidden = !active.speaking;
  if (stageVideoLabel) {
    stageVideoLabel.textContent = active.local && state.localMedia.cameraStatus === MEDIA_STATUS.RECOVERING
      ? 'Đang khôi phục camera…'
      : active.local && [MEDIA_STATUS.DENIED, MEDIA_STATUS.UNAVAILABLE, MEDIA_STATUS.ERROR].includes(state.localMedia.cameraStatus)
        ? 'Không thể kết nối camera'
        : active.cameraEnabled ? 'Camera đang bật' : 'Camera tắt';
  }
}

function renderFilmstrip() {
  const mode = state.screenShare.active
    ? 'presentation'
    : state.view === 'grid' ? 'grid' : 'speaker';
  const result = participantGrid.render({ mode });
  state.filmstripPage = result.currentPage;
  document.querySelector('.meeting-stage-region')?.classList.toggle(
    'has-filmstrip',
    mode !== 'grid' && result.participants.length > 1
  );
  document.querySelector('.filmstrip-wrap')?.classList.toggle(
    'is-single-page',
    mode !== 'grid' && result.participants.length <= 1
  );
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
  menuButton.append(createIcon('ellipsis'));
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
    const actionLabel = isUnavailable
      ? action.id === HOST_ACTIONS.MUTE ? 'Micro đã tắt' : 'Camera đã tắt'
      : action.id === HOST_ACTIONS.SHARE_PERMISSION && participant.shareScreenAllowed
        ? 'Không cho phép chia sẻ màn hình'
        : action.label;
    const actionIcon = {
      [HOST_ACTIONS.MUTE]: 'mic-off',
      [HOST_ACTIONS.STOP_CAMERA]: 'video-off',
      [HOST_ACTIONS.PROMOTE]: 'user-cog',
      [HOST_ACTIONS.DEMOTE]: 'user-cog',
      [HOST_ACTIONS.SHARE_PERMISSION]: 'screen-share',
      [HOST_ACTIONS.REMOVE]: 'user-round-x'
    }[action.id];
    if (actionIcon) actionButton.append(createIcon(actionIcon));
    actionButton.append(document.createTextNode(actionLabel));
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
  microphoneState.setAttribute('aria-label', participant.microphoneEnabled ? 'Micro đang bật' : 'Micro đang tắt');
  const cameraState = document.createElement('span');
  cameraState.className = `participant-row-state${participant.cameraEnabled ? '' : ' is-off'}`;
  cameraState.setAttribute('aria-label', participant.cameraEnabled ? 'Camera đang bật' : 'Camera đang tắt');
  microphoneState.append(createIcon(participant.microphoneEnabled ? 'mic' : 'mic-off'));
  cameraState.append(createIcon(participant.cameraEnabled ? 'video' : 'video-off'));
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
    hand.append(createIcon('hand'));
    hand.setAttribute('aria-label', 'Đang giơ tay');
    item.append(hand);
  }
  if (state.screenShare.presenterId === participant.id) {
    const presenter = document.createElement('span');
    presenter.className = 'participant-presenter-inline';
    presenter.append(createIcon('screen-share'));
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
    approve.append(createIcon('circle-check'), document.createTextNode('Chấp nhận'));
    const reject = document.createElement('button');
    reject.type = 'button';
    reject.dataset.waitingAction = 'reject';
    reject.dataset.waitingId = waitingParticipant.id;
    reject.append(createIcon('circle-x'), document.createTextNode('Từ chối'));
    actions.append(approve, reject);
    item.append(copy, actions);
    return item;
  }));
  renderIcons(list);
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
      renderIcons(presenterList);
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
  renderIcons(list);
  renderIcons(waitingList);
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

function getModerationCopy(action, target) {
  if (action === HOST_ACTIONS.PROMOTE && target) {
    return {
      title: `Chỉ định ${target.name} làm đồng chủ trì?`,
      message: `${target.name} sẽ có thêm quyền quản lý cuộc họp.`,
      confirmText: 'Chỉ định',
      processingTitle: 'Đang cập nhật quyền',
      successTitle: 'Đã chỉ định đồng chủ trì',
      successMessage: `${target.name} hiện là đồng chủ trì.`,
      errorTitle: 'Không thể cập nhật quyền'
    };
  }
  if (action === HOST_ACTIONS.DEMOTE && target) {
    return {
      title: `Thu hồi quyền đồng chủ trì của ${target.name}?`,
      message: `${target.name} sẽ trở lại vai trò thành viên thông thường.`,
      confirmText: 'Thu hồi quyền',
      processingTitle: 'Đang cập nhật quyền',
      successTitle: 'Đã thu hồi quyền đồng chủ trì',
      successMessage: `${target.name} đã trở về vai trò thành viên.`,
      errorTitle: 'Không thể cập nhật quyền'
    };
  }
  if (action === HOST_ACTIONS.REMOVE && target) {
    return {
      title: `Xóa ${target.name} khỏi cuộc họp?`,
      message: 'Người này sẽ bị ngắt kết nối khỏi phòng.',
      confirmText: 'Xóa khỏi cuộc họp',
      processingTitle: 'Đang xóa thành viên',
      successTitle: 'Đã xóa thành viên khỏi cuộc họp',
      successMessage: `${target.name} đã rời khỏi cuộc họp.`,
      errorTitle: 'Không thể xóa thành viên',
      variant: 'danger'
    };
  }
  return {
    title: 'Tắt micro của tất cả thành viên?',
    message: 'Micro của các thành viên đang bật sẽ bị tắt.',
    confirmText: 'Tắt tất cả',
    processingTitle: 'Đang tắt micro của tất cả thành viên',
    successTitle: 'Đã tắt micro của thành viên',
    successMessage: 'Micro của các thành viên đang bật đã được tắt.',
    errorTitle: 'Không thể tắt micro của tất cả thành viên',
    variant: 'danger'
  };
}

async function openModerationConfirmation(action, targetId = null) {
  if (state.moderationActionInFlight) return;
  const target = targetId ? findParticipant(targetId) : null;
  const copy = getModerationCopy(action, target);
  closeParticipantMenu();
  document.querySelector('[data-panel-trigger="participants"]')?.focus({ preventScroll: true });
  const confirmed = await modal.confirm({
    title: copy.title,
    message: copy.message,
    confirmText: copy.confirmText,
    cancelText: 'Hủy',
    variant: copy.variant || 'default',
    dismissOnBackdrop: copy.variant !== 'danger'
  });
  if (!confirmed || state.moderationActionInFlight) return;

  state.moderationActionInFlight = true;
  modal.processing({ title: copy.processingTitle, message: 'Vui lòng chờ trong giây lát.' });
  await new Promise((resolve) => window.setTimeout(resolve, 180));
  const result = await applyModerationAction(action, targetId, { showFeedback: false });
  state.moderationActionInFlight = false;
  if (!result.success) {
    modal.error({
      title: copy.errorTitle,
      message: `${result.message || 'Đã xảy ra lỗi trong quá trình xử lý.'} Vui lòng thử lại.`,
      retryText: 'Thử lại',
      onRetry: () => { void openModerationConfirmation(action, targetId); }
    });
    return;
  }
  modal.success({ title: copy.successTitle, message: copy.successMessage, autoCloseMs: 1500 });
}

async function runModerationActionWithFeedback(action, targetId) {
  if (state.moderationActionInFlight) return;
  const target = targetId ? findParticipant(targetId) : null;
  state.moderationActionInFlight = true;
  modal.processing({ title: 'Đang cập nhật thành viên', message: 'Vui lòng chờ trong giây lát.' });
  await new Promise((resolve) => window.setTimeout(resolve, 180));
  const result = await applyModerationAction(action, targetId, { showFeedback: false });
  state.moderationActionInFlight = false;
  if (!result.success) {
    modal.error({
      title: 'Không thể cập nhật thành viên',
      message: `${result.message || 'Đã xảy ra lỗi trong quá trình xử lý.'} Vui lòng thử lại.`,
      retryText: 'Thử lại',
      onRetry: () => { void runModerationActionWithFeedback(action, targetId); }
    });
    return;
  }
  modal.success({ title: 'Đã tắt micro', message: `${target?.name || 'Thành viên'} đã được tắt micro.`, autoCloseMs: 1400 });
}

async function applyModerationAction(action, targetId, { showFeedback = true } = {}) {
  const target = targetId ? findParticipant(targetId) : null;
  if (target && !canUseHostAction(state.role, target, action)) {
    const message = 'Bạn không có quyền thực hiện thao tác này.';
    if (showFeedback) showToast(message);
    return { success: false, message };
  }
  if (shouldFailModeration(action)) {
    const message = getHostActionFailureMessage(action);
    if (showFeedback) showToast(message);
    return { success: false, message };
  }

  if (!isDemoMode) {
    if (action === 'muteAll') {
      const results = await Promise.all(getParticipants()
        .filter((participant) => !participant.local && participant.microphoneEnabled)
        .map((participant) => meetingService.moderateMeetingParticipant({
          meetingId: state.meetingId,
          participantId: participant.id,
          action: HOST_ACTIONS.MUTE
        })));
      const failed = results.find((result) => !result.success);
      if (failed) return { success: false, message: 'Không thể tắt micro của thành viên.' };
      if (showFeedback) showToast('Đã tắt micro của người tham gia.');
      return { success: true };
    }
    if (!target) return { success: false, message: 'Không tìm thấy thành viên.' };
    const backendAction = action === HOST_ACTIONS.SHARE_PERMISSION ? HOST_ACTIONS.SHARE_PERMISSION : action;
    const result = await meetingService.moderateMeetingParticipant({
      meetingId: state.meetingId,
      participantId: target.id,
      action: backendAction,
      value: action === HOST_ACTIONS.SHARE_PERMISSION ? !target.shareScreenAllowed : null
    });
    if (!result.success) return { success: false, message: getHostActionFailureMessage(action) };
    if (result.participant) mergeRealtimeParticipant(result.participant);
    if (showFeedback) showToast(`${target.name} đã được cập nhật.`);
    return { success: true };
  }

  if (action === HOST_ACTIONS.MUTE && target) {
    state.participants.update(target.id, { microphoneEnabled: false });
    if (showFeedback) showToast(`Đã tắt micro của ${target.name}.`);
  }
  if (action === HOST_ACTIONS.STOP_CAMERA && target) {
    state.participants.update(target.id, { cameraEnabled: false });
    if (showFeedback) showToast(`Đã tắt camera của ${target.name}.`);
  }
  if (action === HOST_ACTIONS.SHARE_PERMISSION && target) {
    const allowed = !target.shareScreenAllowed;
    state.participants.update(target.id, { shareScreenAllowed: allowed });
    if (showFeedback) showToast(allowed ? `Đã cho phép ${target.name} chia sẻ màn hình.` : `Đã tắt quyền chia sẻ màn hình của ${target.name}.`);
  }
  if (action === HOST_ACTIONS.PROMOTE && target) {
    state.participants.update(target.id, { role: PARTICIPANT_ROLES.CO_HOST });
    if (showFeedback) showToast(`${target.name} hiện là đồng chủ trì.`);
  }
  if (action === HOST_ACTIONS.DEMOTE && target) {
    state.participants.update(target.id, { role: PARTICIPANT_ROLES.MEMBER });
    if (showFeedback) showToast(`${target.name} đã trở về vai trò thành viên.`);
  }
  if (action === HOST_ACTIONS.REMOVE && target) {
    state.participants.remove(target.id);
    if (state.activeParticipantId === target.id) state.activeParticipantId = getLocalParticipant().id;
    if (state.screenShare.presenterId === target.id) stopMockRemoteShare();
    if (showFeedback) showToast(`${target.name} đã rời khỏi cuộc họp.`);
  }
  if (action === 'muteAll') {
    getParticipants().filter((participant) => !participant.local).forEach((participant) => {
      state.participants.update(participant.id, { microphoneEnabled: false });
    });
    if (showFeedback) showToast('Đã tắt micro của người tham gia.');
  }
  render();
  return { success: true };
}

function handleParticipantAction(action, participantId) {
  const target = findParticipant(participantId);
  if (!canUseHostAction(state.role, target, action)) {
    closeParticipantMenu();
    showToast('Bạn không có quyền thực hiện thao tác này.');
    return;
  }
  if (action === HOST_ACTIONS.MUTE) {
    closeParticipantMenu();
    void runModerationActionWithFeedback(action, participantId);
    return;
  }
  if ([HOST_ACTIONS.PROMOTE, HOST_ACTIONS.DEMOTE, HOST_ACTIONS.REMOVE].includes(action)) {
    void openModerationConfirmation(action, participantId);
    return;
  }
  closeParticipantMenu();
  void applyModerationAction(action, participantId);
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
  if (!isDemoMode) {
    void meetingService.moderateMeetingParticipant({
      meetingId: state.meetingId,
      participantId: waitingId,
      action: action === 'approve' ? 'approve' : 'reject'
    }).then((result) => {
      if (!result.success) showToast(result.code === 'ROOM_FULL' ? `Cuộc họp đã đủ ${MAX_PARTICIPANTS} người.` : 'Không thể xử lý yêu cầu tham gia.');
      else showToast(action === 'approve' ? `${waiting.name} đã được chấp nhận vào phòng.` : `${waiting.name} đã bị từ chối vào phòng.`);
    });
    return;
  }
  state.waitingParticipants = state.waitingParticipants.filter((participant) => participant.id !== waitingId);
  if (action === 'reject') {
    showToast(`${waiting.name} đã bị từ chối vào phòng.`);
    render();
    return;
  }
  if (getParticipants().length >= MAX_PARTICIPANTS) {
    state.waitingParticipants = [...state.waitingParticipants, waiting];
    showToast(`Cuộc họp đã đủ ${MAX_PARTICIPANTS} người.`);
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

async function handleApproveAll() {
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

  if (!isDemoMode) {
    const waiting = [...state.waitingParticipants];
    const results = await Promise.all(waiting.map((participant) => meetingService.moderateMeetingParticipant({
      meetingId: state.meetingId,
      participantId: participant.id,
      action: 'approve'
    })));
    const failed = results.filter((result) => !result.success);
    if (failed.length) showToast(failed.some((result) => result.code === 'ROOM_FULL') ? `Cuộc họp đã đủ ${MAX_PARTICIPANTS} người.` : 'Không thể xử lý tất cả yêu cầu.');
    else showToast(`Đã chấp nhận ${waiting.length} người.`);
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
    showToast(`Đã chấp nhận ${admitted.length} người. Cuộc họp hiện đã đủ ${MAX_PARTICIPANTS} người.`);
  } else {
    showToast(`Đã chấp nhận ${admitted.length} người.`);
  }
  render();
}

function handlePanelAction(action) {
  if (action === 'mute-all') void openModerationConfirmation('muteAll');
  if (action === 'approve-all') handleApproveAll();
  if (action === 'invite') openInviteModal();
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
    const supported = kind === 'camera'
      ? state.localMedia.cameraSupported && state.localMedia.cameraAvailable
      : state.localMedia.microphoneSupported && state.localMedia.microphoneAvailable;
    const recovering = kind === 'camera'
      ? state.localMedia.cameraStatus === MEDIA_STATUS.RECOVERING
      : state.localMedia.microphoneStatus === MEDIA_STATUS.RECOVERING;
    button.disabled = !supported || recovering;
    if (!supported) button.title = kind === 'camera' ? 'Không tìm thấy camera khả dụng.' : 'Không tìm thấy microphone khả dụng.';
    else if (recovering) button.title = kind === 'camera' ? 'Đang khôi phục camera.' : 'Đang khôi phục microphone.';
    else button.removeAttribute('title');
    button.classList.toggle('is-on', enabled);
    button.classList.toggle('is-off', !enabled);
    button.setAttribute('aria-pressed', String(enabled));
    setIcon(document.querySelector(`[data-toolbar-icon="${kind}"]`), recovering ? 'loader-circle' : enabled ? (kind === 'camera' ? 'video' : 'mic') : (kind === 'camera' ? 'video-off' : 'mic-off'));
    setText(`[data-toolbar-state="${kind}"]`, enabled ? 'Đang bật' : 'Đang tắt');
  });
  setText('[data-member-label]', `${getParticipants().length} người`);
  setText('[data-participant-count]', getParticipants().length);
  updateRecordingUi();
}

function renderShareSupport() {
  const shareButton = document.querySelector('[data-toolbar-action="share"]');
  const supportNote = document.querySelector('[data-share-support-note]');
  const supported = isScreenShareSupported();
  const localShareAllowed = getLocalParticipant()?.shareScreenAllowed !== false;
  const remotePresenter = state.screenShare.active && !state.screenShare.isLocalPresenter
    ? findParticipant(state.screenShare.presenterId)
    : null;
  const requesting = state.screenShare.status === SCREEN_SHARE_STATES.REQUESTING;
  const stopping = state.screenShare.status === SCREEN_SHARE_STATES.STOPPING;
  if (shareButton) {
    shareButton.disabled = requesting || stopping || !localShareAllowed || Boolean(remotePresenter) || (!supported && !state.screenShare.isLocalPresenter);
    if (requesting) {
      setIcon(document.querySelector('[data-share-icon]'), 'loader-circle');
      setText('[data-share-label]', 'Đang mở…');
      setText('[data-share-state]', 'Chọn nguồn');
    } else if (!localShareAllowed) {
      shareButton.title = 'Chủ trì đã tắt quyền chia sẻ màn hình của bạn.';
      shareButton.setAttribute('aria-label', 'Chia sẻ màn hình đã bị tắt');
    } else if (remotePresenter) {
      shareButton.title = `${remotePresenter.name || 'Thành viên'} đang chia sẻ màn hình.`;
      shareButton.setAttribute('aria-label', 'Đang có người chia sẻ màn hình');
    } else if (!supported) {
      shareButton.title = 'Thiết bị hoặc trình duyệt này chưa hỗ trợ chia sẻ màn hình.';
      shareButton.setAttribute('aria-label', 'Chia sẻ màn hình không khả dụng trên thiết bị này');
    } else {
      shareButton.removeAttribute('title');
      shareButton.removeAttribute('aria-label');
    }
  }
  if (supportNote) supportNote.hidden = supported;
}

function renderView() {
  if (state.screenShare.active) {
    stage.hidden = true;
    gridTiles.hidden = true;
    presentationStage.hidden = false;
    if (stageModeStatus) stageModeStatus.hidden = true;
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
  if (stageModeStatus) stageModeStatus.hidden = false;
  const cameraPip = document.querySelector('[data-camera-pip]');
  if (cameraPip) {
    cameraPip.hidden = true;
    cameraPip.srcObject = null;
  }
  stage.hidden = !speakerMode;
  gridTiles.hidden = speakerMode;
  const shareButton = document.querySelector('[data-toolbar-action="share"]');
  shareButton.classList.remove('is-sharing');
  shareButton.setAttribute('aria-pressed', 'false');
  setIcon(document.querySelector('[data-share-icon]'), 'screen-share');
  setText('[data-share-label]', 'Chia sẻ');
  setText('[data-share-state]', 'Màn hình');
  renderShareSupport();
  setText('[data-stage-heading]', speakerMode ? 'Người đang phát biểu' : 'Người tham gia');
  setText('[data-stage-status]', speakerMode ? 'Chế độ người nói' : 'Chế độ lưới');
}

function renderPresentation() {
  const presenter = findParticipant(state.screenShare.presenterId);
  const localPresenter = state.screenShare.isLocalPresenter;
  const shareButton = document.querySelector('[data-toolbar-action="share"]');
  const stopButton = document.querySelector('[data-stop-presentation]');
  const video = presentationVideo;
  const cameraPip = document.querySelector('[data-camera-pip]');

  page.dataset.meetingMode = 'presentation';
  setText('[data-stage-heading]', 'Màn hình đang được chia sẻ');
  setText('[data-presentation-status-text]', localPresenter ? 'Bạn đang chia sẻ màn hình' : `${presenter?.name || 'Thành viên'} đang chia sẻ màn hình`);
  setText('[data-remote-share-title]', `${presenter?.name || 'Thành viên'} đang trình bày`);
  setText('[data-remote-share-topic]', 'Nội dung đang được trình bày trong cuộc họp');
  setIcon(presentationStatusIcon, localPresenter ? 'screen-share-off' : 'screen-share');
  stopButton.hidden = !localPresenter;
  stopButton.textContent = 'Dừng chia sẻ';
  shareButton.classList.toggle('is-sharing', localPresenter);
  shareButton.setAttribute('aria-pressed', String(localPresenter));
  setIcon(document.querySelector('[data-share-icon]'), localPresenter ? 'screen-share-off' : 'screen-share');
  setText('[data-share-label]', localPresenter ? 'Dừng chia sẻ' : 'Chia sẻ');
  setText('[data-share-state]', localPresenter ? 'Đang chia sẻ' : 'Đang có người trình bày');
  renderShareSupport();

  if (localPresenter && state.screenShare.stream) {
    remoteSharePlaceholder.hidden = true;
    presentationEmpty.hidden = true;
    video.hidden = false;
    if (video.srcObject !== state.screenShare.stream) {
      video.srcObject = state.screenShare.stream;
      video.play().catch(() => {});
    }
    const local = getLocalParticipant();
    const showPip = Boolean(local.cameraEnabled && isCameraStreamHealthy() && cameraPip);
    if (cameraPip) {
      cameraPip.hidden = !showPip;
      if (showPip && cameraPip.srcObject !== state.localMedia.cameraStream) {
        cameraPip.srcObject = state.localMedia.cameraStream;
        cameraPip.play().catch(() => {});
      }
      if (!showPip) cameraPip.srcObject = null;
    }
    return;
  }

  video.pause();
  video.srcObject = null;
  video.hidden = true;
  if (cameraPip) {
    cameraPip.hidden = true;
    cameraPip.srcObject = null;
  }
  const hasRemoteTrack = Boolean(!localPresenter && presenter?.livekitIdentity && state.screenShare.track && state.liveKit
    && state.liveKit.attachRemoteTrack(presenter.livekitIdentity, 'screen_share', video));
  video.hidden = !hasRemoteTrack;
  remoteSharePlaceholder.hidden = !presenter || hasRemoteTrack;
  presentationEmpty.hidden = Boolean(presenter);
}

function render() {
  page.dataset.viewMode = state.view;
  renderActiveStage();
  renderFilmstrip();
  renderView();
  renderPanel();
  renderMediaControls();
  const unread = document.querySelector('[data-chat-unread]');
  unread.hidden = state.unreadCount < 1;
  if (!unread.hidden) unread.textContent = String(state.unreadCount);
  setText('[data-raise-hand-label]', getLocalParticipant().handRaised ? 'Hạ tay' : 'Giơ tay');
  updateRecordingUi();
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

function openInviteModal() {
  inviteController.open();
}

async function copyRoomCode() {
  const copied = await copyToClipboard(state.roomCode);
  showToast(copied ? 'Đã sao chép mã phòng.' : 'Không thể sao chép mã phòng.');
}

function openLeaveMenu() {
  if (state.leaveActionInFlight || isMeetingTransitioning()) return;
  const isHost = state.role === PARTICIPANT_ROLES.HOST;
  const recordingActive = recordingController.isActive();
  const recordingReady = recordingController.hasReadyRecording();
  if (!isHost) {
    void requestLeaveConfirmation(false);
    return;
  }

  modal.info({
    eyebrow: 'Kết thúc phiên',
    title: 'Rời cuộc họp hay kết thúc cho tất cả?',
    message: recordingActive
      ? 'Bạn đang ghi hình cuộc họp. Chọn cách xử lý bản ghi trước khi rời phòng.'
      : recordingReady ? 'Bản ghi đã sẵn sàng. Bản ghi sẽ được lưu trước khi bạn rời phòng.' : 'Chọn cách bạn muốn kết thúc phiên này.',
    actions: [
      {
        label: recordingActive ? 'Dừng ghi và rời' : recordingReady ? 'Lưu và rời' : 'Rời cuộc họp',
        variant: 'secondary',
        onClick: () => { void requestLeaveConfirmation(false); }
      },
      {
        label: recordingActive ? 'Dừng ghi và kết thúc cho tất cả' : recordingReady ? 'Lưu và kết thúc cho tất cả' : 'Kết thúc cho tất cả',
        variant: 'danger',
        onClick: () => { void requestLeaveConfirmation(true); }
      }
    ],
    cancelText: 'Ở lại'
  });
}

async function requestLeaveConfirmation(endForEveryone = false) {
  if (state.leaveActionInFlight || isMeetingTransitioning()) return;
  const recordingActive = recordingController.isActive();
  const recordingReady = recordingController.hasReadyRecording();
  const isEnd = Boolean(endForEveryone && state.role === PARTICIPANT_ROLES.HOST);
  const confirmation = recordingActive && !isEnd
    ? {
      title: 'Bạn đang ghi hình cuộc họp',
      message: 'Dừng ghi và rời cuộc họp?',
      confirmText: 'Dừng ghi và rời',
      cancelText: 'Hủy',
      variant: 'danger'
    }
    : recordingReady
      ? {
        title: 'Bản ghi đã sẵn sàng',
        message: `Bản ghi sẽ được lưu xuống thiết bị trước khi ${isEnd ? 'kết thúc cuộc họp.' : 'bạn rời cuộc họp.'}`,
        confirmText: isEnd ? 'Lưu và kết thúc' : 'Lưu và rời',
        cancelText: 'Hủy'
      }
    : isEnd
      ? {
        title: 'Kết thúc cuộc họp cho mọi người?',
        message: 'Tất cả thành viên sẽ bị ngắt kết nối khỏi phòng. Hành động này không thể hoàn tác.',
        confirmText: 'Kết thúc cuộc họp',
        cancelText: 'Hủy',
        variant: 'danger',
        dismissOnBackdrop: false
      }
      : {
        title: 'Rời cuộc họp?',
        message: 'Bạn sẽ rời khỏi phòng nhưng cuộc họp vẫn tiếp tục.',
        confirmText: 'Rời cuộc họp',
        cancelText: 'Ở lại'
      };
  const confirmed = await modal.confirm(confirmation);
  if (confirmed) await leaveMeeting(isEnd);
}

function getLocalMediaErrorMessage(kind, error) {
  const deviceName = kind === 'camera' ? 'camera' : 'microphone';
  switch (error?.name) {
    case 'NotAllowedError':
      return `Chưa được cấp quyền sử dụng ${deviceName}.`;
    case 'NotFoundError':
      return `Không tìm thấy ${deviceName}.`;
    case 'NotReadableError':
      return `${deviceName[0].toUpperCase()}${deviceName.slice(1)} đang được ứng dụng khác sử dụng.`;
    case 'OverconstrainedError':
      return `Không thể sử dụng ${deviceName} đã chọn.`;
    default:
      return `Không thể bật ${deviceName} lúc này.`;
  }
}

const trackRequestLocks = { camera: null, microphone: null };

async function requestMeetingTrack(kind, deviceId = '') {
  if (trackRequestLocks[kind]) return trackRequestLocks[kind];
  const request = (async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { success: false, error: { name: 'UnsupportedError' } };
  }

  const getConstraints = (preferredDeviceId = '') => kind === 'camera'
    ? { video: preferredDeviceId ? { deviceId: { exact: preferredDeviceId } } : true, audio: false }
    : { video: false, audio: preferredDeviceId ? { deviceId: { exact: preferredDeviceId } } : true };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(getConstraints(deviceId));
      const track = kind === 'camera' ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0];
      if (!track) throw new DOMException('No media track', 'NotFoundError');
      return { success: true, stream, track };
    } catch (error) {
      if (deviceId && ['NotFoundError', 'OverconstrainedError'].includes(error?.name)) {
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia(getConstraints());
          const fallbackTrack = kind === 'camera'
            ? fallbackStream.getVideoTracks()[0]
            : fallbackStream.getAudioTracks()[0];
          if (fallbackTrack) return { success: true, stream: fallbackStream, track: fallbackTrack };
          fallbackStream.getTracks().forEach((track) => track.stop());
        } catch (fallbackError) {
          return { success: false, error: fallbackError };
        }
      }
      return { success: false, error };
    }
  })();
  trackRequestLocks[kind] = request;
  try {
    return await request;
  } finally {
    if (trackRequestLocks[kind] === request) trackRequestLocks[kind] = null;
  }
}

function rebuildLocalMediaStream() {
  const tracks = [
    state.localMedia.cameraStream?.getVideoTracks?.()[0],
    state.localMedia.microphoneStream?.getAudioTracks?.()[0]
  ].filter(Boolean);
  if (!tracks.length) {
    media.setStream(null);
    return;
  }
  const combinedStream = typeof MediaStream === 'function'
    ? new MediaStream(tracks)
    : state.localMedia.cameraStream || state.localMedia.microphoneStream;
  media.setStream(combinedStream);
}

function setLocalTrack(kind, result) {
  const streamKey = kind === 'camera' ? 'cameraStream' : 'microphoneStream';
  const deviceKey = kind === 'camera' ? 'cameraDeviceId' : 'micDeviceId';
  const enabledKey = kind === 'camera' ? 'cameraEnabled' : 'microphoneEnabled';
  const preferenceKey = kind === 'camera' ? 'cameraPreference' : 'microphonePreference';
  const statusKey = kind === 'camera' ? 'cameraStatus' : 'microphoneStatus';
  const previousStream = state.localMedia[streamKey];
  if (previousStream && previousStream !== result.stream) {
    previousStream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
  }
  state.localMedia[streamKey] = result.stream;
  state.localMedia[statusKey] = MEDIA_STATUS.LIVE;
  state.localMedia[enabledKey] = Boolean(state.localMedia[preferenceKey]);
  state.localMedia[deviceKey] = result.track.getSettings?.()?.deviceId || state.localMedia[deviceKey];
  media.setDeviceIds({
    cameraDeviceId: state.localMedia.cameraDeviceId,
    micDeviceId: state.localMedia.micDeviceId
  });
  result.track.onended = () => {
    if (state.localMedia[streamKey] !== result.stream) return;
    state.localMedia[enabledKey] = false;
    state.localMedia[statusKey] = state.localMedia[preferenceKey] ? MEDIA_STATUS.RECOVERING : MEDIA_STATUS.OFF;
    if (kind === 'camera') media.setCameraEnabled(false);
    else media.setMicrophoneEnabled(false);
    syncLocalParticipant();
    persistLocalMediaPreferences();
    render();
    if (state.localMedia[preferenceKey] && !state.isCleaningUp && document.visibilityState === 'visible') {
      window.setTimeout(() => { void recoverLocalMedia(kind); }, 0);
    }
  };
  rebuildLocalMediaStream();
}

function persistLocalMediaPreferences() {
  saveMediaPreferences({
    cameraEnabled: state.localMedia.cameraPreference,
    micEnabled: state.localMedia.microphonePreference,
    cameraDeviceId: state.localMedia.cameraDeviceId,
    micDeviceId: state.localMedia.micDeviceId
  });
}

async function initializeLocalMedia() {
  const supported = Boolean(navigator.mediaDevices?.getUserMedia);
  state.localMedia.cameraSupported = supported;
  state.localMedia.microphoneSupported = supported;

  const local = getLocalParticipant();
  if (isDemoMode) {
    state.localMedia.cameraEnabled = local.cameraEnabled;
    state.localMedia.microphoneEnabled = local.microphoneEnabled;
    state.localMedia.cameraPreference = local.cameraEnabled;
    state.localMedia.microphonePreference = local.microphoneEnabled;
    state.localMedia.cameraStatus = local.cameraEnabled ? MEDIA_STATUS.LIVE : MEDIA_STATUS.OFF;
    state.localMedia.microphoneStatus = local.microphoneEnabled ? MEDIA_STATUS.LIVE : MEDIA_STATUS.OFF;
    state.localMedia.cameraSupported = true;
    state.localMedia.microphoneSupported = true;
    state.localMedia.cameraAvailable = true;
    state.localMedia.microphoneAvailable = true;
    media.setCameraEnabled(local.cameraEnabled);
    media.setMicrophoneEnabled(local.microphoneEnabled);
    return;
  }

  if (!supported) {
    state.localMedia.cameraEnabled = false;
    state.localMedia.microphoneEnabled = false;
    state.localMedia.cameraPreference = false;
    state.localMedia.microphonePreference = false;
    state.localMedia.cameraStatus = MEDIA_STATUS.UNAVAILABLE;
    state.localMedia.microphoneStatus = MEDIA_STATUS.UNAVAILABLE;
    state.localMedia.cameraAvailable = false;
    state.localMedia.microphoneAvailable = false;
    media.setCameraEnabled(false);
    media.setMicrophoneEnabled(false);
    state.participants.update(local.id, { cameraEnabled: false, microphoneEnabled: false });
    persistLocalMediaPreferences();
    return;
  }

  const preferences = getMediaPreferences();
  state.localMedia.cameraDeviceId = preferences.cameraDeviceId;
  state.localMedia.micDeviceId = preferences.micDeviceId;
  state.localMedia.cameraPreference = preferences.cameraEnabled;
  state.localMedia.microphonePreference = preferences.micEnabled;
  state.localMedia.cameraEnabled = state.localMedia.cameraPreference;
  state.localMedia.microphoneEnabled = state.localMedia.microphonePreference;
  state.localMedia.cameraStatus = state.localMedia.cameraPreference ? MEDIA_STATUS.REQUESTING : MEDIA_STATUS.OFF;
  state.localMedia.microphoneStatus = state.localMedia.microphonePreference ? MEDIA_STATUS.REQUESTING : MEDIA_STATUS.OFF;

  let devices = [];
  if (navigator.mediaDevices.enumerateDevices) {
    try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { devices = []; }
  }
  if (devices.length) {
    state.localMedia.cameraAvailable = devices.some((device) => device.kind === 'videoinput');
    state.localMedia.microphoneAvailable = devices.some((device) => device.kind === 'audioinput');
  }
  if (!state.localMedia.cameraAvailable) {
    state.localMedia.cameraEnabled = false;
    state.localMedia.cameraStatus = MEDIA_STATUS.UNAVAILABLE;
  }
  if (!state.localMedia.microphoneAvailable) {
    state.localMedia.microphoneEnabled = false;
    state.localMedia.microphoneStatus = MEDIA_STATUS.UNAVAILABLE;
  }

  const failures = [];
  if (state.localMedia.cameraPreference && state.localMedia.cameraAvailable) {
    const result = await requestMeetingTrack('camera', state.localMedia.cameraDeviceId);
    if (result.success) setLocalTrack('camera', result);
    else {
      state.localMedia.cameraEnabled = false;
      state.localMedia.cameraAvailable = result.error?.name !== 'NotFoundError';
      state.localMedia.cameraStatus = result.error?.name === 'NotAllowedError' ? MEDIA_STATUS.DENIED : state.localMedia.cameraAvailable ? MEDIA_STATUS.ERROR : MEDIA_STATUS.UNAVAILABLE;
      failures.push(getLocalMediaErrorMessage('camera', result.error));
    }
  }
  if (state.localMedia.microphonePreference && state.localMedia.microphoneAvailable) {
    const result = await requestMeetingTrack('microphone', state.localMedia.micDeviceId);
    if (result.success) setLocalTrack('microphone', result);
    else {
      state.localMedia.microphoneEnabled = false;
      state.localMedia.microphoneAvailable = result.error?.name !== 'NotFoundError';
      state.localMedia.microphoneStatus = result.error?.name === 'NotAllowedError' ? MEDIA_STATUS.DENIED : state.localMedia.microphoneAvailable ? MEDIA_STATUS.ERROR : MEDIA_STATUS.UNAVAILABLE;
      failures.push(getLocalMediaErrorMessage('microphone', result.error));
    }
  }

  media.setDeviceIds({
    cameraDeviceId: state.localMedia.cameraDeviceId,
    micDeviceId: state.localMedia.micDeviceId
  });
  media.setCameraEnabled(state.localMedia.cameraEnabled);
  media.setMicrophoneEnabled(state.localMedia.microphoneEnabled);
  rebuildLocalMediaStream();
  state.participants.update(local.id, {
    cameraEnabled: state.localMedia.cameraEnabled,
    microphoneEnabled: state.localMedia.microphoneEnabled
  });
  persistLocalMediaPreferences();
  if (failures.length) showToast(failures.join(' '));
}

async function bindVideoPlayback(video, stream) {
  if (!video) return;
  if (video.srcObject !== stream) video.srcObject = stream || null;
  if (stream && video.paused) {
    try { await video.play(); } catch { /* Playback may wait for the browser to resume the tab. */ }
  }
}

async function recoverLocalMedia(kind) {
  const isCamera = kind === 'camera';
  const preferenceKey = isCamera ? 'cameraPreference' : 'microphonePreference';
  const enabledKey = isCamera ? 'cameraEnabled' : 'microphoneEnabled';
  const statusKey = isCamera ? 'cameraStatus' : 'microphoneStatus';
  const availableKey = isCamera ? 'cameraAvailable' : 'microphoneAvailable';
  const deviceKey = isCamera ? 'cameraDeviceId' : 'micDeviceId';
  if (!state.localMedia[preferenceKey] || state.isCleaningUp) {
    state.localMedia[enabledKey] = false;
    state.localMedia[statusKey] = MEDIA_STATUS.OFF;
    const track = isCamera ? getLiveCameraTrack() : getLiveMicrophoneTrack();
    if (track) track.enabled = false;
    if (isCamera) media.setCameraEnabled(false);
    else media.setMicrophoneEnabled(false);
    syncLocalParticipant();
    return { success: false, code: 'DISABLED' };
  }

  const healthy = isCamera ? isCameraStreamHealthy() : isMicrophoneStreamHealthy();
  if (healthy) {
    state.localMedia[enabledKey] = true;
    state.localMedia[statusKey] = MEDIA_STATUS.LIVE;
    const track = isCamera ? getLiveCameraTrack() : getLiveMicrophoneTrack();
    track.enabled = true;
    if (isCamera) {
      media.setCameraEnabled(true);
      await bindVideoPlayback(document.querySelector('[data-local-stage-video]'), state.localMedia.cameraStream);
      await bindVideoPlayback(document.querySelector('[data-camera-pip]'), state.localMedia.cameraStream);
    } else {
      media.setMicrophoneEnabled(true);
    }
    await syncLiveKitMediaTrack(kind);
    syncLocalParticipant();
    return { success: true, reused: true };
  }

  state.localMedia[enabledKey] = false;
  state.localMedia[statusKey] = MEDIA_STATUS.RECOVERING;
  syncLocalParticipant();
  render();

  const result = await requestMeetingTrack(kind, state.localMedia[deviceKey]);
  if (result.success && state.localMedia[preferenceKey] && !state.isCleaningUp) {
    setLocalTrack(kind, result);
    state.localMedia[enabledKey] = true;
    state.localMedia[statusKey] = MEDIA_STATUS.LIVE;
    if (isCamera) media.setCameraEnabled(true);
    else media.setMicrophoneEnabled(true);
    await syncLiveKitMediaTrack(kind);
    syncLocalParticipant();
    persistLocalMediaPreferences();
    render();
    return { success: true, reused: false };
  }

  if (result.stream) {
    result.stream.getTracks().forEach((track) => track.stop());
  }
  state.localMedia[enabledKey] = false;
  state.localMedia[availableKey] = result.error?.name !== 'NotFoundError';
  state.localMedia[statusKey] = result.error?.name === 'NotAllowedError'
    ? MEDIA_STATUS.DENIED
    : state.localMedia[availableKey] ? MEDIA_STATUS.ERROR : MEDIA_STATUS.UNAVAILABLE;
  syncLocalParticipant();
  render();
  if (!state.isCleaningUp) showToast(getLocalMediaErrorMessage(kind, result.error));
  return { success: false, error: result.error };
}

async function ensureCameraPlayback() {
  return recoverLocalMedia('camera');
}

async function ensureMicrophonePlayback() {
  return recoverLocalMedia('microphone');
}

async function refreshDeviceAvailability({ recover = false } = {}) {
  if (isDemoMode || !navigator.mediaDevices?.enumerateDevices) return;
  let devices;
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return;
  }
  const cameraAvailable = devices.some((device) => device.kind === 'videoinput');
  const microphoneAvailable = devices.some((device) => device.kind === 'audioinput');
  state.localMedia.cameraAvailable = cameraAvailable;
  state.localMedia.microphoneAvailable = microphoneAvailable;
  if (!cameraAvailable) {
    state.localMedia.cameraEnabled = false;
    state.localMedia.cameraStatus = MEDIA_STATUS.UNAVAILABLE;
  }
  if (!microphoneAvailable) {
    state.localMedia.microphoneEnabled = false;
    state.localMedia.microphoneStatus = MEDIA_STATUS.UNAVAILABLE;
  }
  if (recover && cameraAvailable && state.localMedia.cameraPreference && !isCameraStreamHealthy()) await ensureCameraPlayback();
  if (recover && microphoneAvailable && state.localMedia.microphonePreference && !isMicrophoneStreamHealthy()) await ensureMicrophonePlayback();
  syncLocalParticipant();
  render();
}

async function toggleLocalMedia(kind) {
  const local = getLocalParticipant();
  const isCamera = kind === 'camera';
  const enabledKey = isCamera ? 'cameraEnabled' : 'microphoneEnabled';
  const streamKey = isCamera ? 'cameraStream' : 'microphoneStream';
  const deviceKey = isCamera ? 'cameraDeviceId' : 'micDeviceId';
  const enabled = Boolean(state.localMedia[enabledKey]);

  if (enabled) {
    if (isCamera) state.localMedia.cameraPreference = false;
    else state.localMedia.microphonePreference = false;
    state.localMedia[enabledKey] = false;
    state.localMedia[isCamera ? 'cameraStatus' : 'microphoneStatus'] = MEDIA_STATUS.OFF;
    if (isCamera) media.setCameraEnabled(false);
    else media.setMicrophoneEnabled(false);
  } else {
    if (isCamera) state.localMedia.cameraPreference = true;
    else state.localMedia.microphonePreference = true;
    const existingTrack = state.localMedia[streamKey]?.getTracks?.()[0];
    if (!existingTrack || existingTrack.readyState !== 'live') {
      const result = await requestMeetingTrack(kind, state.localMedia[deviceKey]);
      if (!result.success) {
        if (result.error?.name === 'NotFoundError') state.localMedia[isCamera ? 'cameraAvailable' : 'microphoneAvailable'] = false;
        state.localMedia[isCamera ? 'cameraStatus' : 'microphoneStatus'] = result.error?.name === 'NotAllowedError'
          ? MEDIA_STATUS.DENIED
          : result.error?.name === 'NotFoundError' ? MEDIA_STATUS.UNAVAILABLE : MEDIA_STATUS.ERROR;
        if (isCamera) state.localMedia.cameraPreference = false;
        else state.localMedia.microphonePreference = false;
        showToast(getLocalMediaErrorMessage(kind, result.error));
        render();
        return;
      }
      setLocalTrack(kind, result);
    }
    state.localMedia[enabledKey] = true;
    state.localMedia[isCamera ? 'cameraStatus' : 'microphoneStatus'] = MEDIA_STATUS.LIVE;
    if (isCamera) media.setCameraEnabled(true);
    else media.setMicrophoneEnabled(true);
  }

  persistLocalMediaPreferences();
  state.participants.upsert({ ...local, [enabledKey]: state.localMedia[enabledKey] });
  const transportResult = await syncLiveKitMediaTrack(kind);
  if (!transportResult.success && !isDemoMode) showToast('Không thể cập nhật thiết bị trong cuộc họp.');
  const mediaStateResult = await meetingService.setMeetingMediaState({
    meetingId: state.meetingId,
    cameraEnabled: state.localMedia.cameraEnabled,
    microphoneEnabled: state.localMedia.microphoneEnabled
  });
  if (!mediaStateResult.success && !isDemoMode) showToast('Không thể đồng bộ trạng thái thiết bị.');
  render();
}

async function syncLiveKitMediaTrack(kind) {
  if (!state.liveKit || !state.liveKitConnected) return { success: true };
  const isCamera = kind === 'camera';
  const enabledKey = isCamera ? 'cameraEnabled' : 'microphoneEnabled';
  const track = isCamera ? getLiveCameraTrack() : getLiveMicrophoneTrack();
  if (state.localMedia[enabledKey] && track) {
    const publishResult = isCamera
      ? await state.liveKit.publishCamera(track)
      : await state.liveKit.publishMicrophone(track);
    if (!publishResult.success) return publishResult;
  }
  const enabledResult = isCamera
    ? await state.liveKit.setCameraEnabled(state.localMedia[enabledKey])
    : await state.liveKit.setMicrophoneEnabled(state.localMedia[enabledKey]);
  if (!enabledResult.success && enabledResult.success !== 'NOT_PUBLISHED') return enabledResult;
  return { success: true };
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

  if (state.screenShare.presenterId && !state.screenShare.isLocalPresenter) {
    showToast('Hiện đang có người trình bày.');
    return;
  }
  if (getLocalParticipant()?.shareScreenAllowed === false) {
    showToast('Chủ trì đã tắt quyền chia sẻ màn hình của bạn.');
    return;
  }

  const shareButton = document.querySelector('[data-toolbar-action="share"]');
  shareButton.disabled = true;
  setIcon(document.querySelector('[data-share-icon]'), 'loader-circle');
  setText('[data-share-label]', 'Đang mở…');
  setText('[data-share-state]', 'Chọn nguồn');
  const result = await startScreenShare();
  render();
  if (result.started || result.reason === 'CANCELLED') return;
  if (result.reason === 'REMOTE_ACTIVE') {
    showToast('Hiện đang có người trình bày.');
    return;
  }
  if (result.reason === 'UNSUPPORTED') {
    showToast('Thiết bị hoặc trình duyệt này chưa hỗ trợ chia sẻ màn hình.');
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
  if (!ALLOWED_REACTIONS.has(reaction)) return;
  const local = getLocalParticipant();
  if (local) {
    state.participants.update(local.id, {
      reaction,
      reactionExpiresAt: Date.now() + 2_800
    });
  }
  void state.liveKit?.publishData({
    type: 'reaction',
    meetingId: state.meetingId,
    participantId: state.participantId,
    value: reaction,
    sentAt: Date.now()
  });
  document.querySelector('[data-reaction-popover]').hidden = true;
  document.querySelector('[data-reaction-toggle]').setAttribute('aria-expanded', 'false');
  render();
}

function toggleRaiseHand() {
  const local = getLocalParticipant();
  const handRaised = !local.handRaised;
  state.participants.upsert({ ...local, handRaised });
  void state.liveKit?.publishData({ type: 'hand', value: handRaised });
  void meetingService.setMeetingMediaState({
    meetingId: state.meetingId,
    cameraEnabled: state.localMedia.cameraEnabled,
    microphoneEnabled: state.localMedia.microphoneEnabled,
    handRaised
  });
  showToast(handRaised ? 'Bạn đã giơ tay.' : 'Bạn đã hạ tay.');
  render();
}

function setView(view) {
  state.userSelectedView = true;
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
  const indicator = document.querySelector('[data-connection-indicator]');
  if (!scenario) {
    if (indicator) indicator.hidden = true;
    return;
  }
  if (indicator) indicator.hidden = false;
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

async function handleChatSubmit(event) {
  event.preventDefault();
  const input = event.currentTarget.elements.message;
  const content = String(input.value ?? '').trim();
  if (!content) return;
  if (!isDemoMode) {
    const result = await state.meetingRealtime?.sendMessage(content);
    if (!result?.success) {
      showToast('Không thể gửi tin nhắn.');
      return;
    }
  } else {
    state.messages.push({ author: state.displayName, content });
  }
  input.value = '';
  renderChat();
  input.focus();
}

function handleParticipantSearch() {
  if (state.panel === 'participants') renderParticipantsPanel();
}

async function handleScreenShareState(nextState) {
  const wasLocalPresenter = state.screenShare.isLocalPresenter;
  state.screenShare = {
    active: Boolean(nextState.active),
    presenterId: nextState.presenterId,
    isLocalPresenter: Boolean(nextState.isLocalPresenter),
    stream: nextState.stream || null,
    track: nextState.track || null,
    settings: nextState.settings || null,
    status: nextState.status || (nextState.active ? SCREEN_SHARE_STATES.LIVE : SCREEN_SHARE_STATES.IDLE)
  };
  state.localMedia.isScreenSharing = state.screenShare.isLocalPresenter;
  if (state.liveKit && state.liveKitConnected) {
    if (state.screenShare.isLocalPresenter && state.screenShare.track) {
      void state.liveKit.publishScreenShare(state.screenShare.track);
    } else if (wasLocalPresenter && !state.screenShare.active) {
      void state.liveKit.stopScreenShare();
    }
  }
  const localPresenterTransition = state.screenShare.isLocalPresenter || wasLocalPresenter;
  if (!isDemoMode && state.meetingRealtime && state.meetingId && localPresenterTransition) {
    const result = await state.meetingRealtime.setScreenShareState(state.screenShare.active);
    if (!result.success && state.screenShare.active) {
      stopScreenShare({ source: 'server' });
      showToast(result.code === 'SCREEN_SHARE_ACTIVE' ? 'Hiện đang có người trình bày.' : 'Không thể đồng bộ chia sẻ màn hình.');
      return;
    }
  }
  render();
}

function toUiParticipant(value, { local = false } = {}) {
  const participant = normalizeRealtimeParticipant(value) || value;
  if (!participant?.id && !participant?.livekitIdentity) return null;
  return {
    ...participant,
    id: participant.id || participant.livekitIdentity,
    name: participant.name || participant.displayName || 'Gmail user',
    local,
    role: participant.role || PARTICIPANT_ROLES.MEMBER,
    cameraEnabled: Boolean(participant.cameraEnabled),
    microphoneEnabled: Boolean(participant.microphoneEnabled),
    shareScreenAllowed: participant.shareScreenAllowed !== false,
    handRaised: Boolean(participant.handRaised),
    speaking: Boolean(participant.speaking)
  };
}

function isLocalRealtimeParticipant(participant) {
  return Boolean(participant && (
    participant.id === state.participantId
    || participant.sessionId === state.sessionId
    || participant.livekitIdentity === state.localParticipantIdentity
  ));
}

function removeParticipantEverywhere(participantId) {
  state.participants?.remove(participantId);
  state.waitingParticipants = state.waitingParticipants.filter((participant) => participant.id !== participantId);
  if (state.activeParticipantId === participantId) state.activeParticipantId = getLocalParticipant()?.id || 'local';
  if (state.screenShare.presenterId === participantId) {
    state.screenShare = { ...state.screenShare, active: false, presenterId: null, track: null, stream: null, isLocalPresenter: false };
  }
}

function handleRemoteParticipantRemoved() {
  if (state.meetingEndHandled || state.leaveActionInFlight) return;
  state.meetingEndHandled = true;
  state.leaveActionInFlight = true;
  page.dataset.meetingState = 'removed';
  void cleanup({ finalizeRecording: true }).finally(() => {
    modal.info({
      eyebrow: 'Quyền tham gia đã kết thúc',
      title: 'Bạn đã bị xóa khỏi cuộc họp',
      message: 'Chủ trì đã ngắt kết nối bạn khỏi phòng.',
      actions: [{ label: 'Về Dashboard', variant: 'primary', onClick: navigateToDashboard }]
    });
  });
}

function mergeRealtimeParticipant(value, eventType = 'UPDATE') {
  const participant = normalizeRealtimeParticipant(value) || value;
  if (!participant) return;
  const local = isLocalRealtimeParticipant(participant);
  const existingBeforeChange = state.participants ? findParticipant(participant.id) : null;
  if (local && ['removed', 'blocked', 'rejected'].includes(participant.status)) {
    handleRemoteParticipantRemoved();
    return;
  }

  const uiParticipant = toUiParticipant(participant, { local });
  if (!uiParticipant) return;
  const isWaiting = participant.status === 'waiting';
  const isActive = ['joining', 'admitted'].includes(participant.status);
  if (!isActive && !isWaiting || eventType === 'DELETE') {
    if (existingBeforeChange && !local && state.realtimeParticipantsHydrated) {
      showToast(['removed', 'blocked'].includes(participant.status)
        ? `${existingBeforeChange.name} đã bị xóa khỏi cuộc họp`
        : `${existingBeforeChange.name} đã rời cuộc họp`);
    }
    removeParticipantEverywhere(uiParticipant.id);
    render();
    return;
  }
  if (isWaiting) {
    removeParticipantEverywhere(uiParticipant.id);
    state.waitingParticipants = [...state.waitingParticipants.filter((item) => item.id !== uiParticipant.id), uiParticipant];
  } else {
    state.waitingParticipants = state.waitingParticipants.filter((item) => item.id !== uiParticipant.id);
    const existing = existingBeforeChange || findParticipant(uiParticipant.id);
    state.participants.upsert({
      ...existing,
      ...uiParticipant,
      role: participant.roleFromMetadata || ['INSERT', 'UPDATE'].includes(eventType)
        ? participant.role
        : existing?.role || uiParticipant.role,
      cameraTrack: uiParticipant.cameraTrack || existing?.cameraTrack || null,
      microphoneTrack: uiParticipant.microphoneTrack || existing?.microphoneTrack || null,
      screenShareTrack: uiParticipant.screenShareTrack || existing?.screenShareTrack || null,
      cameraPublication: uiParticipant.cameraPublication || existing?.cameraPublication || null,
      microphonePublication: uiParticipant.microphonePublication || existing?.microphonePublication || null,
      screenSharePublication: uiParticipant.screenSharePublication || existing?.screenSharePublication || null
    });
  }

  if (eventType === 'connected' || eventType === 'INSERT') {
    if (!local && state.realtimeParticipantsHydrated
      && (eventType === 'INSERT' || state.liveKitParticipantsHydrated)) {
      showToast(`${uiParticipant.name} đã tham gia cuộc họp`);
    }
  }

  if (!local && participant.screenSharing) {
    state.screenShare = {
      ...state.screenShare,
      active: true,
      presenterId: uiParticipant.id,
      isLocalPresenter: false,
      stream: null,
      track: state.screenShare.presenterId === uiParticipant.id ? state.screenShare.track : null,
      status: SCREEN_SHARE_STATES.LIVE
    };
  } else if (!local && state.screenShare.presenterId === uiParticipant.id && !participant.screenSharing) {
    state.screenShare = {
      ...state.screenShare,
      active: false,
      presenterId: null,
      isLocalPresenter: false,
      stream: null,
      track: null,
      status: SCREEN_SHARE_STATES.IDLE
    };
  }

  if (local) {
    state.participantId = uiParticipant.id;
    if (uiParticipant.role && uiParticipant.role !== state.role) {
      state.role = uiParticipant.role;
      role = uiParticipant.role;
    }
    if (participant.cameraEnabled === false && state.localMedia.cameraEnabled) {
      state.localMedia.cameraEnabled = false;
      state.localMedia.cameraPreference = false;
      void state.liveKit?.setCameraEnabled(false);
    }
    if (participant.microphoneEnabled === false && state.localMedia.microphoneEnabled) {
      state.localMedia.microphoneEnabled = false;
      state.localMedia.microphonePreference = false;
      void state.liveKit?.setMicrophoneEnabled(false);
    }
    if (participant.shareScreenAllowed === false && state.screenShare.isLocalPresenter) {
      stopScreenShare({ source: 'permission' });
    }
  }
  render();
}

function replaceRealtimeParticipants(values) {
  const previous = new Map(getParticipants().map((participant) => [participant.id, participant]));
  const next = values
    .map((value) => {
      const local = isLocalRealtimeParticipant(value);
      const participant = toUiParticipant(value, { local });
      const old = participant ? previous.get(participant.id) : null;
      return participant ? {
        ...old,
        ...participant,
        role: participant.roleFromMetadata ? participant.role : old?.role || participant.role,
        cameraTrack: participant.cameraTrack || old?.cameraTrack || null,
        microphoneTrack: participant.microphoneTrack || old?.microphoneTrack || null,
        screenShareTrack: participant.screenShareTrack || old?.screenShareTrack || null,
        cameraPublication: participant.cameraPublication || old?.cameraPublication || null,
        microphonePublication: participant.microphonePublication || old?.microphonePublication || null,
        screenSharePublication: participant.screenSharePublication || old?.screenSharePublication || null
      } : null;
    })
    .filter(Boolean)
    .filter((participant) => ['joining', 'admitted'].includes(participant.status || 'admitted'));
  if (!next.some((participant) => participant.local)) {
    const local = getLocalParticipant();
    if (local) next.unshift(local);
  }
  const nextById = new Map(next.map((participant) => [participant.id, participant]));
  const orderedNext = [
    ...getParticipants().map((participant) => nextById.get(participant.id)).filter(Boolean),
    ...next.filter((participant) => !getParticipants().some((current) => current.id === participant.id))
  ];
  state.participants = createParticipantStore(orderedNext);
  state.realtimeParticipantsHydrated = true;
  state.waitingParticipants = values
    .filter((value) => value.status === 'waiting')
    .map((value) => toUiParticipant(value, { local: isLocalRealtimeParticipant(value) }))
    .filter(Boolean);
  const remotePresenter = values
    .filter((value) => value.status === 'admitted' && value.screenSharing && !isLocalRealtimeParticipant(value))
    .map((value) => toUiParticipant(value))
    .find(Boolean);
  if (remotePresenter) {
    state.screenShare = {
      ...state.screenShare,
      active: true,
      presenterId: remotePresenter.id,
      isLocalPresenter: false,
      stream: null,
      track: state.screenShare.presenterId === remotePresenter.id ? state.screenShare.track : null,
      status: SCREEN_SHARE_STATES.LIVE
    };
  } else if (!state.screenShare.isLocalPresenter && state.screenShare.active) {
    state.screenShare = {
      ...state.screenShare,
      active: false,
      presenterId: null,
      stream: null,
      track: null,
      status: SCREEN_SHARE_STATES.IDLE
    };
  }
  if (!next.some((participant) => participant.id === state.activeParticipantId)) state.activeParticipantId = next[0]?.id || 'local';
  if (!state.userSelectedView) state.view = next.length > 1 ? 'grid' : 'speaker';
  render();
}

function findParticipantByLiveKitIdentity(identity) {
  return getParticipants().find((participant) => participant.livekitIdentity === identity)
    || state.waitingParticipants.find((participant) => participant.livekitIdentity === identity);
}

function handleLiveKitParticipants(values) {
  if (!values?.length) return;
  if (!state.liveKitParticipantsHydrated) {
    state.initialLiveKitParticipantKeys = new Set(
      values.map((value) => String(value.id || value.livekitIdentity || '').trim())
    );
  }
  values.forEach((value) => {
    if (value.local) {
      state.participantId = value.id || state.participantId;
      state.localParticipantIdentity = value.livekitIdentity || state.localParticipantIdentity;
    }
  });
  const snapshots = values.map((value) => ({
    ...value,
    id: value.id || value.livekitIdentity,
    status: 'admitted'
  }));
  state.liveKitParticipantsHydrated = true;
  replaceRealtimeParticipants(snapshots);
}

function handleLiveKitParticipant(value) {
  if (!value) return;
  if (value.disconnected) {
    const existing = findParticipantByLiveKitIdentity(value.livekitIdentity) || getParticipants().find((item) => item.id === value.id);
    if (existing) {
      if (state.liveKitParticipantsHydrated && !existing.local && !state.meetingEndHandled) {
        showToast(`${existing.name} đã rời cuộc họp`);
      }
      removeParticipantEverywhere(existing.id);
      render();
    }
    return;
  }
  const existing = findParticipantByLiveKitIdentity(value.livekitIdentity);
  const liveKitKey = String(value.id || value.livekitIdentity || '').trim();
  const isInitialParticipant = state.initialLiveKitParticipantKeys.has(liveKitKey);
  state.initialLiveKitParticipantKeys.delete(liveKitKey);
  mergeRealtimeParticipant({
    ...existing,
    ...value,
    id: value.id || existing?.id || value.livekitIdentity,
    status: 'admitted',
    eventType: value.eventType || 'updated'
  }, isInitialParticipant ? 'updated' : value.eventType || 'UPDATE');
  const updatedParticipant = findParticipantByLiveKitIdentity(value.livekitIdentity)
    || getParticipants().find((participant) => participant.id === value.id);
  if (updatedParticipant && ['camera', 'microphone', 'screen_share'].includes(value.source)
    && ['track-published', 'track-unpublished'].includes(value.eventType)) {
    const changes = value.source === 'camera'
      ? { cameraTrack: value.cameraTrack || null }
      : value.source === 'microphone'
        ? { microphoneTrack: value.microphoneTrack || null }
        : { screenShareTrack: value.screenShareTrack || null };
    state.participants.update(updatedParticipant.id, changes);
    render();
  }
}

function handleLiveKitTrack({ type, track, participant, source }) {
  const remote = findParticipantByLiveKitIdentity(participant?.identity);
  let metadata = {};
  try { metadata = JSON.parse(participant?.metadata || '{}'); } catch { metadata = {}; }
  const participantId = remote?.id || metadata.participantId || participant?.identity;
  if (!participantId) return;
  if (!remote && !getParticipants().some((item) => item.id === participantId)) {
    state.participants.upsert(toUiParticipant({
      id: participantId,
      userId: metadata.userId,
      livekitIdentity: participant.identity,
      name: participant.name,
      role: metadata.role,
      status: 'admitted',
      cameraEnabled: false,
      microphoneEnabled: false,
      shareScreenAllowed: metadata.shareScreenAllowed !== false
    }));
  }
  if (source === 'camera') {
    state.participants.update(participantId, {
      cameraEnabled: true,
      cameraTrack: track
    });
  } else if (source === 'microphone') {
    state.participants.update(participantId, { microphoneEnabled: true, microphoneTrack: track });
  } else if (source === 'screen_share') {
    state.screenShare = {
      ...state.screenShare,
      active: true,
      presenterId: participantId,
      isLocalPresenter: false,
      stream: null,
      track,
      status: SCREEN_SHARE_STATES.LIVE
    };
    state.participants.update(participantId, {
      screenShareActive: true,
      screenShareTrack: track,
      screenSharing: true
    });
  }
  render();
}

function handleLiveKitTrackRemoved({ track, participant, source }) {
  const remote = findParticipantByLiveKitIdentity(participant?.identity);
  if (source === 'camera' && remote) state.participants.update(remote.id, { cameraEnabled: false, cameraTrack: null });
  if (source === 'microphone' && remote) state.participants.update(remote.id, { microphoneEnabled: false, microphoneTrack: null });
  if (source === 'screen_share' && state.screenShare.presenterId === remote?.id) {
    state.screenShare = { ...state.screenShare, active: false, presenterId: null, track: null, stream: null, isLocalPresenter: false };
  }
  if (source === 'screen_share' && remote) state.participants.update(remote.id, { screenShareActive: false, screenShareTrack: null, screenSharing: false });
  track?.detach?.();
  render();
}

function handleLiveKitData(data, participant) {
  if (!data || typeof data !== 'object') return;
  if (data.meetingId && data.meetingId !== state.meetingId) return;
  if (data.type === 'reaction' && ALLOWED_REACTIONS.has(data.value)) {
    const target = findParticipantByLiveKitIdentity(participant?.identity);
    if (target) {
      state.participants.update(target.id, {
        reaction: data.value,
        reactionExpiresAt: Date.now() + 2_800
      });
      render();
    }
  }
  if (data.type === 'hand') {
    const target = findParticipantByLiveKitIdentity(participant?.identity);
    if (target) state.participants.update(target.id, { handRaised: Boolean(data.value) });
    render();
  }
}

function handleMeetingRealtimeMessage(message) {
  const normalized = normalizeRealtimeMessage(message);
  if (!normalized || state.messages.some((item) => item.id && item.id === normalized.id)) return;
  state.messages.push(normalized);
  if (state.panel !== 'chat') state.unreadCount += 1;
  renderChat();
  render();
}

function handleMeetingRealtimeUpdate(meeting) {
  if (!meeting) return;
  if (meeting.status === MEETING_STATUSES.ENDING || meeting.status === MEETING_STATUSES.ENDED) {
    void handleRemoteMeetingEnded();
    return;
  }
  if (meeting.title) state.meetingTitle = meeting.title;
  if (meeting.startedAt) state.startedAt = Date.parse(meeting.startedAt) || Number(meeting.startedAt) || state.startedAt;
  setText('[data-meeting-title]', state.meetingTitle);
}

function getRealtimeErrorMessage(code) {
  if (code === 'ROOM_FULL') return `Cuộc họp đã đủ ${MAX_PARTICIPANTS} người tham gia.`;
  if (code === 'MEETING_ENDED') return 'Cuộc họp đã kết thúc.';
  if (code === 'MEETING_NOT_STARTED') return 'Chủ phòng chưa bắt đầu cuộc họp.';
  if (code === 'LIVEKIT_NOT_CONFIGURED') return 'Cuộc họp chưa được cấu hình kết nối realtime.';
  if (code === 'AUDIO_PLAYBACK_BLOCKED') return 'Chạm để bật âm thanh cuộc họp.';
  return 'Không thể kết nối cuộc họp.';
}

async function initializeRealtimeMeeting() {
  if (isDemoMode) return { success: true };
  state.meetingId = state.meetingId || meetingContext.meeting?.id || getStoredJoinedMeeting()?.id || '';
  if (!state.meetingId) return { success: false, code: 'MEETING_NOT_FOUND' };

  const tokenResult = await requestLiveKitToken(state.roomCode, state.sessionId);
  if (!tokenResult.success) return tokenResult;
  state.meetingId = tokenResult.meetingId;
  state.participantId = tokenResult.participantId;
  state.localParticipantIdentity = tokenResult.livekitIdentity || '';
  state.liveKit = createLiveKitRoomController({
    onParticipants: handleLiveKitParticipants,
    onParticipant: handleLiveKitParticipant,
    onTrack: handleLiveKitTrack,
    onTrackRemoved: handleLiveKitTrackRemoved,
    onData: handleLiveKitData,
    onSpeakers: (identities) => {
      getParticipants().forEach((participant) => state.participants.update(participant.id, {
        speaking: identities.includes(participant.livekitIdentity)
      }));
      const activeSpeaker = getParticipants().find((participant) => identities.includes(participant.livekitIdentity));
      if (activeSpeaker) state.activeParticipantId = activeSpeaker.id;
      render();
    },
    onConnection: (connectionState) => {
      state.liveKitConnected = connectionState === 'CONNECTED';
      if (connectionState === 'RECONNECTING') {
        const indicator = document.querySelector('[data-connection-indicator]');
        if (indicator) indicator.hidden = false;
        setConnection('reconnecting', 'Đang kết nối lại…');
      } else if (connectionState === 'CONNECTED') {
        const indicator = document.querySelector('[data-connection-indicator]');
        if (indicator) indicator.hidden = true;
      }
    },
    onDisconnected: (reason) => {
      const reasonValue = String(reason || '').toLowerCase();
      if (reasonValue.includes('removed')) handleRemoteParticipantRemoved();
      else if (reasonValue.includes('deleted') || reasonValue.includes('room')) void handleRemoteMeetingEnded();
      else showToast('Không thể kết nối cuộc họp.');
    },
    onError: ({ code }) => {
      if (code === 'AUDIO_PLAYBACK_BLOCKED') {
        showToast(getRealtimeErrorMessage(code));
        document.addEventListener('pointerdown', () => { void state.liveKit?.startAudio?.(); }, { once: true, passive: true });
      }
    }
  });

  state.meetingRealtime = createMeetingRealtimeController({
    meetingId: state.meetingId,
    sessionId: state.sessionId,
    onParticipants: replaceRealtimeParticipants,
    onParticipant: mergeRealtimeParticipant,
    onMessage: handleMeetingRealtimeMessage,
    onMeeting: handleMeetingRealtimeUpdate,
    onConnection: (status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') showToast('Không thể kết nối đồng bộ cuộc họp.');
    },
    onError: ({ code }) => {
      if (!state.isCleaningUp) showToast(getRealtimeErrorMessage(code));
    }
  });
  const realtimeResult = await state.meetingRealtime.connect();
  if (!realtimeResult.success) return realtimeResult;
  const liveKitResult = await state.liveKit.connect({ token: tokenResult.token, livekitUrl: tokenResult.livekitUrl });
  if (!liveKitResult.success) return liveKitResult;
  state.liveKitConnected = true;
  await publishLocalMediaToLiveKit();
  return { success: true };
}

async function publishLocalMediaToLiveKit() {
  if (!state.liveKit) return;
  if (state.localMedia.cameraEnabled && getLiveCameraTrack()) await state.liveKit.publishCamera(getLiveCameraTrack());
  if (state.localMedia.microphoneEnabled && getLiveMicrophoneTrack()) await state.liveKit.publishMicrophone(getLiveMicrophoneTrack());
  await state.meetingRealtime?.setMediaState({
    cameraEnabled: state.localMedia.cameraEnabled,
    microphoneEnabled: state.localMedia.microphoneEnabled
  });
}

async function ensureScreenSharePlayback() {
  if (!state.screenShare.isLocalPresenter) return { success: true, active: false };
  const shareState = getScreenShareState();
  if (!isScreenShareHealthy() || !getLiveScreenTrack()) {
    stopScreenShare({ source: 'browser' });
    return { success: false, active: false };
  }

  state.screenShare.active = true;
  state.screenShare.stream = shareState.stream;
  state.screenShare.track = shareState.track || null;
  state.screenShare.settings = shareState.settings || null;
  state.screenShare.status = shareState.status || SCREEN_SHARE_STATES.LIVE;
  state.localMedia.isScreenSharing = true;
  await bindVideoPlayback(presentationVideo, shareState.stream);
  await bindVideoPlayback(document.querySelector('[data-camera-pip]'), state.localMedia.cameraStream);
  return { success: true, active: true };
}

function reconcileMediaState() {
  const shareState = getScreenShareState();
  if (shareState.active !== state.screenShare.active
    || shareState.presenterId !== state.screenShare.presenterId
    || shareState.stream !== state.screenShare.stream) {
    state.screenShare = {
      active: shareState.active,
      presenterId: shareState.presenterId,
      isLocalPresenter: shareState.isLocalPresenter,
      stream: shareState.stream || null,
      track: shareState.track || null,
      settings: shareState.settings || null,
      status: shareState.status || (shareState.active ? SCREEN_SHARE_STATES.LIVE : SCREEN_SHARE_STATES.IDLE)
    };
    state.localMedia.isScreenSharing = shareState.isLocalPresenter;
  }
  syncLocalParticipant();
  render();
}

async function resumeMeetingAfterVisibility() {
  if (state.resumePromise) return state.resumePromise;
  state.resumePromise = (async () => {
    if (state.isCleaningUp || isMeetingTransitioning()) return null;
    const authResult = await revalidateSessionSilently();
    if (page.dataset.authGuardState !== 'AUTHENTICATED' || state.isCleaningUp) return authResult;

    await ensureCameraPlayback();
    await ensureMicrophonePlayback();
    await ensureScreenSharePlayback();
    reconcileMediaState();
    updateDuration();
    return authResult;
  })();
  try {
    return await state.resumePromise;
  } finally {
    state.resumePromise = null;
  }
}

function requestMeetingResume() {
  if (document.visibilityState !== 'visible' || isMeetingTransitioning()) return;
  void resumeMeetingAfterVisibility();
}

function handlePageHide(event) {
  // A persisted page is returning from BFCache, so its media session must survive.
  if (event.persisted) return;
  void cleanup();
}

function handlePageShow(event) {
  if (event.persisted || document.visibilityState === 'visible') requestMeetingResume();
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') requestMeetingResume();
}

function handleWindowFocus() {
  requestMeetingResume();
}

function cleanup({ finalizeRecording = true } = {}) {
  if (state.cleanupPromise) return state.cleanupPromise;
  state.cleanupPromise = (async () => {
  state.isCleaningUp = true;
  if (finalizeRecording) await recordingController.cleanup({ finalize: true });
  else await recordingController.cleanup({ finalize: false });
  window.clearInterval(state.timer);
  window.clearInterval(state.speakerTimer);
  window.clearTimeout(state.reconnectTimer);
  window.clearTimeout(state.toastTimer);
  state.timer = 0;
  state.speakerTimer = 0;
  state.reconnectTimer = 0;
  state.toastTimer = 0;
  try { await state.meetingRealtime?.leave?.(); } catch { /* Membership cleanup is best effort. */ }
  try { await state.liveKit?.disconnect?.({ stopTracks: false }); } catch { /* LiveKit cleanup is best effort. */ }
  state.meetingRealtime?.close?.();
  state.meetingRealtime = null;
  state.liveKit?.close?.();
  state.liveKit = null;
  try { state.unsubscribeMeetingEvents?.(); } catch { /* Runtime cleanup is best effort. */ }
  state.unsubscribeMeetingEvents = null;
  try { state.unsubscribeScreenShare?.(); } catch { /* Runtime cleanup is best effort. */ }
  state.unsubscribeScreenShare = null;
  try { cleanupScreenShare(); } catch { /* Runtime cleanup is best effort. */ }
  participantGrid.destroy();
  state.localMedia.cameraStream?.getTracks?.().forEach((track) => { track.onended = null; });
  state.localMedia.microphoneStream?.getTracks?.().forEach((track) => { track.onended = null; });
  state.localMedia.cameraStream = null;
  state.localMedia.microphoneStream = null;
  try { media.stop?.(); } catch { /* Runtime cleanup is best effort. */ }
  document.querySelectorAll('video').forEach((video) => {
    video.pause?.();
    video.srcObject = null;
  });
  })();
  const cleanupPromise = state.cleanupPromise;
  return cleanupPromise.finally(() => {
    if (state.cleanupPromise === cleanupPromise) state.cleanupPromise = null;
  });
}

async function startRecording() {
  if (state.recordingActionInFlight || recordingController.isActive()) return;
  state.recordingActionInFlight = true;
  modal.processing({ title: 'Đang bắt đầu ghi hình', message: 'Nội dung cuộc họp sẽ được ghi lại trên thiết bị này.' });
  let result;
  try {
    result = await recordingController.start();
  } catch {
    result = { success: false, code: 'START_FAILED' };
  }
  state.recordingActionInFlight = false;
  if (!result.success) {
    const message = result.code === 'UNSUPPORTED'
      ? 'Trình duyệt này chưa hỗ trợ ghi hình cuộc họp.'
      : 'Vui lòng thử lại.';
    modal.error({
      title: 'Không thể bắt đầu ghi hình',
      message,
      retryText: 'Thử lại',
      onRetry: () => { void startRecording(); }
    });
    return result;
  }
  modal.success({ title: 'Đã bắt đầu ghi hình', message: 'Biểu tượng REC sẽ hiển thị trong suốt quá trình ghi.', autoCloseMs: 1500 });
  return result;
}

async function requestStartRecording() {
  if (state.recordingActionInFlight || recordingController.isActive()) return;
  const confirmed = await modal.confirm({
    title: 'Bắt đầu ghi hình?',
    message: 'Nội dung cuộc họp sẽ được ghi lại trên thiết bị này. Biểu tượng REC sẽ hiển thị trong suốt quá trình ghi.',
    confirmText: 'Bắt đầu ghi',
    cancelText: 'Hủy'
  });
  if (confirmed) await startRecording();
}

async function stopRecording({ openReady = true, autoSave = false, showFeedback = true, showProcessing = true } = {}) {
  if (state.recordingActionInFlight) return { success: false, code: 'ACTION_IN_PROGRESS' };
  state.recordingActionInFlight = true;
  if (showProcessing) modal.processing({ title: 'Đang xử lý bản ghi', message: 'Vui lòng chờ trong giây lát.' });
  let result;
  try {
    result = await recordingController.stop();
  } catch {
    result = { success: false, code: 'STOP_FAILED' };
  }
  if (!result.success) {
    state.recordingActionInFlight = false;
    if (showFeedback) {
      modal.error({
        title: 'Không thể hoàn tất bản ghi',
        message: 'Vui lòng thử lại.',
        retryText: 'Thử lại',
        onRetry: () => { void requestStopRecording(); }
      });
    }
    return result;
  }
  if (autoSave && !recordingController.save()) {
    state.recordingActionInFlight = false;
    const saveResult = { success: false, code: 'SAVE_FAILED' };
    if (showFeedback) {
      modal.error({
        title: 'Không thể lưu bản ghi',
        message: 'Bản ghi chưa được lưu xuống thiết bị. Vui lòng thử lại.',
        retryText: 'Thử lại',
        onRetry: () => { void stopRecording({ openReady: false, autoSave: true }); }
      });
    }
    return saveResult;
  }
  state.recordingActionInFlight = false;
  if (openReady) {
    modal.success({
      title: 'Bản ghi đã sẵn sàng',
      message: 'Bản ghi được tạo trên trình duyệt này và chưa được tải lên máy chủ.',
      confirmText: 'Lưu bản ghi',
      cancelText: 'Để sau',
      onConfirm: saveReadyRecording
    });
  }
  return result;
}

async function requestStopRecording() {
  if (state.recordingActionInFlight || !recordingController.isActive()) return;
  const confirmed = await modal.confirm({
    title: 'Dừng ghi hình?',
    message: 'Bản ghi hiện tại sẽ được hoàn tất và xử lý.',
    confirmText: 'Dừng ghi',
    cancelText: 'Tiếp tục ghi',
    variant: 'danger',
    dismissOnBackdrop: false
  });
  if (confirmed) await stopRecording();
}

async function handleRecordingToggle() {
  if (recordingController.isActive()) await requestStopRecording();
  else await requestStartRecording();
}

function saveReadyRecording() {
  if (recordingController.save()) {
    modal.success({ title: 'Đã lưu bản ghi', message: 'Bản ghi đã được lưu xuống thiết bị.', autoCloseMs: 1500 });
  } else {
    modal.error({ title: 'Không thể lưu bản ghi', message: 'Bản ghi chưa được lưu xuống thiết bị. Vui lòng thử lại.' });
  }
}

// SECURITY: Ending a meeting for everyone must be authorized by trusted server logic; client role is UI-only.
function restoreMeetingAfterTransition() {
  state.leaveActionInFlight = false;
  page.dataset.meetingState = 'normal';
  document.querySelectorAll('button').forEach((button) => { button.disabled = false; });
  render();
}

function getEndMeetingErrorMessage(code) {
  if (code === END_MEETING_ERROR_CODES.NETWORK_ERROR) return 'Không có kết nối Internet. Vui lòng thử lại.';
  if (code === END_MEETING_ERROR_CODES.PERMISSION_DENIED) return 'Bạn không có quyền kết thúc cuộc họp này.';
  if (code === END_MEETING_ERROR_CODES.INVALID_STATE) return 'Cuộc họp không còn ở trạng thái đang diễn ra.';
  return 'Không thể kết thúc cuộc họp. Vui lòng thử lại.';
}

function createLeaveResult(reason, leftAt = Date.now()) {
  return {
    meetingTitle: String(state.meetingTitle || 'Cuộc họp FLASH MEETING'),
    roomCode: String(state.roomCode || ''),
    reason,
    joinedAt: state.startedAt || null,
    leftAt,
    durationSeconds: state.startedAt > 0 ? Math.max(0, Math.floor((leftAt - state.startedAt) / 1000)) : 0
  };
}

function navigateToDashboard() {
  modal.close();
  window.location.href = getPageUrl('index.html');
}

function showMeetingEndedModal() {
  modal.info({
    eyebrow: 'Cuộc họp đã kết thúc',
    title: 'Cuộc họp đã kết thúc',
    message: 'Chủ trì đã kết thúc cuộc họp.',
    actions: [
      { label: 'Về Dashboard', variant: 'primary', onClick: navigateToDashboard }
    ]
  });
}

async function handleRemoteMeetingEnded() {
  if (state.meetingEndHandled || state.leaveActionInFlight || isMeetingTransitioning()) return;
  state.meetingEndHandled = true;
  state.leaveActionInFlight = true;
  page.dataset.meetingState = 'ended';
  try {
    await cleanup({ finalizeRecording: true });
  } catch {
    // The meeting is already closed remotely; media cleanup remains best effort.
  }
  writeSession('flashMeeting.leaveResult', JSON.stringify(createLeaveResult('MEETING_ENDED')));
  showMeetingEndedModal();
}

function handleMeetingEvent(event) {
  if (event?.type !== 'MEETING_ENDED') return;
  const eventRoomCode = String(event.roomCode || '').trim().toUpperCase();
  if (eventRoomCode && eventRoomCode !== state.roomCode) return;
  void handleRemoteMeetingEnded();
}

async function leaveMeeting(endForEveryone = false) {
  if (state.leaveActionInFlight || isMeetingTransitioning()) return;
  const shouldEndForEveryone = Boolean(endForEveryone && state.role === PARTICIPANT_ROLES.HOST);
  const recordingNeedsFinalization = recordingController.isActive() || recordingController.hasReadyRecording();
  const leftAt = Date.now();
  const leaveResult = createLeaveResult(shouldEndForEveryone ? 'ENDED_FOR_ALL' : 'LEFT', leftAt);

  state.leaveActionInFlight = true;
  page.dataset.meetingState = shouldEndForEveryone ? 'ending' : 'leaving';
  document.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  modal.processing({
    title: shouldEndForEveryone ? 'Đang kết thúc cuộc họp' : 'Đang rời cuộc họp',
    message: 'Vui lòng chờ trong giây lát.'
  });
  if (recordingNeedsFinalization) {
    const recordingResult = await stopRecording({ openReady: false, autoSave: true, showFeedback: false, showProcessing: false });
    if (!recordingResult.success) {
      restoreMeetingAfterTransition();
      modal.error({
        title: shouldEndForEveryone ? 'Không thể kết thúc cuộc họp' : 'Không thể rời cuộc họp',
        message: 'Không thể hoàn tất bản ghi. Vui lòng thử lại.',
        retryText: 'Thử lại',
        onRetry: () => { void leaveMeeting(shouldEndForEveryone); }
      });
      return;
    }
  }

  if (shouldEndForEveryone) {
    try {
      await stopScreenShare();
    } catch {
      // Screen-share shutdown is best effort before the meeting is finalized.
    }

    let endResult;
    try {
      endResult = await meetingService.endMeeting({ roomCode: state.roomCode });
    } catch {
      endResult = { success: false, code: END_MEETING_ERROR_CODES.END_MEETING_FAILED };
    }
    if (!endResult?.success) {
      restoreMeetingAfterTransition();
      modal.error({
        title: 'Không thể kết thúc cuộc họp',
        message: getEndMeetingErrorMessage(endResult?.code),
        retryText: 'Thử lại',
        onRetry: () => { void leaveMeeting(true); }
      });
      return;
    }

    state.meetingEndHandled = true;
    page.dataset.meetingState = 'ended';
    try {
      await cleanup({ finalizeRecording: false });
    } catch {
      // The meeting is finalized; local media cleanup is best effort.
    }
    writeSession('flashMeeting.leaveResult', JSON.stringify(leaveResult));
    modal.success({
      title: 'Cuộc họp đã kết thúc',
      message: 'Tất cả thành viên đã được ngắt kết nối.',
      autoCloseMs: 700
    });
    window.setTimeout(() => { window.location.href = getPageUrl('index.html'); }, 760);
    return;
  }

  try {
    await cleanup({ finalizeRecording: false });
  } catch {
    restoreMeetingAfterTransition();
    modal.error({
      title: shouldEndForEveryone ? 'Không thể kết thúc cuộc họp' : 'Không thể rời cuộc họp',
      message: 'Vui lòng thử lại.',
      retryText: 'Thử lại',
      onRetry: () => { void leaveMeeting(shouldEndForEveryone); }
    });
    return;
  }
  writeSession('flashMeeting.leaveResult', JSON.stringify(leaveResult));
  modal.success({
    title: shouldEndForEveryone ? 'Cuộc họp đã kết thúc' : 'Bạn đã rời cuộc họp',
    message: shouldEndForEveryone ? 'Tất cả thành viên đã được ngắt kết nối.' : 'Cuộc họp vẫn tiếp tục với những người còn lại.',
    autoCloseMs: 700
  });
  window.setTimeout(() => { window.location.href = getPageUrl('meeting-ended.html'); }, 760);
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
  document.querySelector('[data-recording-control]')?.addEventListener('click', handleRecordingToggle);
  document.querySelectorAll('[data-save-recording]').forEach((button) => button.addEventListener('click', saveReadyRecording));
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
  document.querySelector('[data-filmstrip-prev]')?.addEventListener('click', () => {
    participantGrid.setPage(participantGrid.getPage() - 1);
    render();
  });
  document.querySelector('[data-filmstrip-next]')?.addEventListener('click', () => {
    participantGrid.setPage(participantGrid.getPage() + 1);
    render();
  });
  document.querySelector('[data-chat-form]')?.addEventListener('submit', handleChatSubmit);
  document.querySelector('[data-participant-search]')?.addEventListener('input', handleParticipantSearch);
  document.querySelector('[data-open-invite]')?.addEventListener('click', openInviteModal);
  document.querySelector('[data-leave-meeting]')?.addEventListener('click', openLeaveMenu);
  document.querySelectorAll('[data-copy-room]').forEach((button) => button.addEventListener('click', copyRoomCode));
  window.addEventListener('resize', () => renderFilmstrip());
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);
  window.addEventListener('beforeunload', () => { void cleanup(); });
  window.addEventListener('focus', handleWindowFocus);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  if (!state.deviceChangeBound) {
    navigator.mediaDevices?.addEventListener?.('devicechange', () => { void refreshDeviceAvailability({ recover: true }); });
    state.deviceChangeBound = true;
  }
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (closeParticipantMenu()) return;
    closeMoreMenu();
    document.querySelector('[data-reaction-popover]').hidden = true;
    if (state.panel) closePanel();
  });
}

async function initialize() {
  const sessionResult = await protectPage();
  if (!sessionResult.success || !sessionResult.session) return;

  meetingContext = meetingService.getCurrentParticipantContext(getRoomCode());
  if ([MEETING_STATUSES.ENDING, MEETING_STATUSES.ENDED].includes(meetingContext.meeting?.status)) {
    state.meetingTitle = meetingContext.meeting.title || state.meetingTitle;
    state.hostName = meetingContext.meeting.hostName || state.hostName;
    state.startedAt = meetingContext.meeting.startedAt || state.startedAt;
    page.dataset.meetingState = 'ended';
    showMeetingEndedModal();
    return;
  }
  role = meetingContext.role || PARTICIPANT_ROLES.MEMBER;
  state.role = role;
  state.displayName = sessionResult.user.displayName;
  state.meetingId = meetingContext.meeting?.id || getStoredJoinedMeeting()?.id || state.meetingId;
  try {
    const storedParticipant = JSON.parse(readSession('flashMeeting.joinedParticipant') || 'null');
    if (storedParticipant?.id) state.participantId = storedParticipant.id;
    if (storedParticipant?.role) {
      state.role = storedParticipant.role;
      role = storedParticipant.role;
    }
  } catch {
    // The realtime token remains the source of truth for participant identity.
  }
  state.hostName = meetingContext.meeting?.hostName || 'Chủ phòng';
  state.participants = createParticipants();
  if (!state.userSelectedView && getParticipants().length > 1) state.view = 'grid';
  state.waitingParticipants = createWaitingParticipants();
  state.unsubscribeMeetingEvents = subscribeMeetingEvents(handleMeetingEvent);
  state.unsubscribeScreenShare = subscribeScreenShare(handleScreenShareState);
  await initializeLocalMedia();
  const local = getLocalParticipant();
  state.activeParticipantId = getParticipants().find((participant) => participant.speaking)?.id || local.id;
  page.dataset.meetingState = 'connected';
  setText('[data-meeting-title]', state.meetingTitle);
  setText('[data-room-code]', state.roomCode);
  setText('[data-capacity]', MAX_PARTICIPANTS);
  setText('[data-info-host]', state.hostName);
  setText('[data-info-capacity]', `${MAX_PARTICIPANTS} thành viên`);
  document.querySelector('[data-toolbar-action="share"]')?.setAttribute('data-share-supported', String(isScreenShareSupported()));
  bindEvents();
  render();
  updateDuration();
  state.timer = window.setInterval(updateDuration, 1000);
  const realtimeResult = await initializeRealtimeMeeting();
  if (!realtimeResult.success) {
    page.dataset.meetingState = 'error';
    showToast(getRealtimeErrorMessage(realtimeResult.code));
    modal.error({
      title: 'Không thể kết nối cuộc họp',
      message: getRealtimeErrorMessage(realtimeResult.code),
      retryText: 'Thử lại',
      onRetry: () => window.location.reload()
    });
    return;
  }
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

registerAuthExpiryCleanup(cleanup);
initialize();
