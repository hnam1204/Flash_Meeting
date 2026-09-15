import { authService } from './auth-service.js';
import {
  JOIN_MEETING_ERROR_CODES,
  MAX_MEETING_PARTICIPANTS,
  START_MEETING_ERROR_CODES,
  meetingService
} from './meeting-service.js';
import {
  getPageUrl,
  isLikelyRoomCode,
  normalizeRoomCode,
  readStoredRoomCode,
  setStatus
} from './utils.js';
import { getMediaPreferences, saveMediaPreferences } from './meeting-media.js';
import { protectPage, registerAuthExpiryCleanup } from './auth-guard.js';
import { modal } from './ui/modal-manager.js';
import { renderIcons, setIcon } from './ui/icons.js';
import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  validateMeetingDisplayName
} from './display-name.js';

const PREJOIN_STATES = Object.freeze({
  INITIALIZING: 'initializing',
  REQUESTING_MEDIA: 'requesting-media',
  READY: 'ready',
  JOINING: 'joining',
  SUCCESS: 'success',
  ERROR: 'error',
  MEDIA_DENIED: 'media-denied',
  NO_DEVICE: 'no-device'
});

const MEDIA_STATUS = Object.freeze({
  ON: 'on',
  OFF: 'off',
  DENIED: 'denied',
  NO_DEVICE: 'no-device'
});

const REDIRECT_DELAY = 420;

const page = document.body;
const form = document.querySelector('[data-prejoin-form]');
const status = document.querySelector('[data-form-status]');
const banner = document.querySelector('[data-prejoin-banner]');
const displayNameInput = form?.elements.displayName;
const video = document.querySelector('[data-local-preview]');
const placeholder = document.querySelector('[data-preview-placeholder]');
const placeholderTitle = document.querySelector('[data-preview-placeholder-title]');
const placeholderCopy = document.querySelector('[data-preview-placeholder-copy]');
const previewName = document.querySelector('[data-preview-name]');
const cameraState = document.querySelector('[data-camera-state]');
const meetingSummary = document.querySelector('[data-meeting-summary]');
const meetingTitle = document.querySelector('[data-meeting-title]');
const meetingMeta = document.querySelector('[data-meeting-meta]');
const prejoinHeading = document.querySelector('[data-prejoin-heading]');
const submitButton = document.querySelector('[data-prejoin-submit]');
const submitLabel = document.querySelector('[data-prejoin-submit-label]');
const cameraSelect = document.querySelector('[data-device-select="camera"]');
const microphoneSelect = document.querySelector('[data-device-select="microphone"]');
const cameraToggle = document.querySelector('[data-media-toggle="camera"]');
const microphoneToggle = document.querySelector('[data-media-toggle="microphone"]');
const submitIcon = document.querySelector('.prejoin-submit-icon');

renderIcons();

const state = {
  roomCode: '',
  meeting: null,
  participantContext: null,
  mediaStream: null,
  selectedCameraId: '',
  selectedMicrophoneId: '',
  cameraStatus: MEDIA_STATUS.NO_DEVICE,
  microphoneStatus: MEDIA_STATUS.NO_DEVICE,
  cameraEnabled: false,
  microphoneEnabled: false
};

function wait(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function setPrejoinState(nextState) {
  page.dataset.prejoinState = nextState;
}

function setStatusMessage(message, statusState = 'info') {
  setStatus(status, message, statusState);
}

function setBanner(message, bannerState = 'info') {
  if (!banner) return;
  banner.hidden = !message;
  banner.textContent = message;
  banner.dataset.state = bannerState;
}

function persistMediaPreferences() {
  return saveMediaPreferences({
    cameraEnabled: state.cameraEnabled,
    micEnabled: state.microphoneEnabled,
    cameraDeviceId: state.selectedCameraId,
    micDeviceId: state.selectedMicrophoneId
  });
}

function applyStoredMediaPreferences() {
  const preferences = getMediaPreferences();
  state.cameraEnabled = preferences.cameraEnabled;
  state.microphoneEnabled = preferences.micEnabled;
  state.selectedCameraId = preferences.cameraDeviceId;
  state.selectedMicrophoneId = preferences.micDeviceId;
  state.cameraStatus = state.cameraEnabled ? MEDIA_STATUS.NO_DEVICE : MEDIA_STATUS.OFF;
  state.microphoneStatus = state.microphoneEnabled ? MEDIA_STATUS.NO_DEVICE : MEDIA_STATUS.OFF;
}

function isOffline() {
  return navigator.onLine === false;
}

function getStoredDisplayName() {
  let storedParticipant = null;
  let storedName = '';
  try {
    storedName = sessionStorage.getItem('flashMeeting.displayName') || '';
    storedParticipant = JSON.parse(sessionStorage.getItem('flashMeeting.joinedParticipant') || 'null');
  } catch {
    // Session storage is optional in restricted browser contexts.
  }

  for (const candidate of [storedParticipant?.displayName, storedName, authService.getSession()?.displayName]) {
    const validation = validateMeetingDisplayName(candidate);
    if (validation.valid) return validation.value;
  }
  return '';
}

function redirectToJoin() {
  const url = new URL(getPageUrl('join-meeting.html'), window.location.href);
  if (state.roomCode) url.searchParams.set('room', state.roomCode);
  window.location.replace(url.href);
}

function getRoomCodeFromUrl() {
  const rawRoomCode = new URLSearchParams(window.location.search).get('room') || readStoredRoomCode();
  const roomCode = normalizeRoomCode(rawRoomCode);
  return isLikelyRoomCode(roomCode) ? roomCode : '';
}

function setFormDisabled(disabled) {
  form?.querySelectorAll('input, select, button').forEach((control) => {
    control.disabled = disabled;
  });
  document.querySelectorAll('[data-media-toggle]').forEach((control) => {
    control.disabled = disabled;
  });
}

function setDeviceStatus(kind, message) {
  const statusElement = document.querySelector(`[data-device-status="${kind}"]`);
  if (statusElement) statusElement.textContent = message;
}

function getDeviceStatusText(kind, mediaStatus) {
  if (mediaStatus === MEDIA_STATUS.ON) return kind === 'camera' ? 'Camera đã sẵn sàng.' : 'Microphone đã sẵn sàng.';
  if (mediaStatus === MEDIA_STATUS.OFF) return kind === 'camera' ? 'Camera đang tắt.' : 'Microphone đang tắt.';
  if (mediaStatus === MEDIA_STATUS.NO_DEVICE) return kind === 'camera' ? 'Không tìm thấy camera.' : 'Không tìm thấy microphone.';
  return kind === 'camera' ? 'FLASH MEETING chưa được phép sử dụng camera.' : 'FLASH MEETING chưa được phép sử dụng microphone.';
}

function getMediaErrorMessage(kind, error) {
  const deviceName = kind === 'camera' ? 'camera' : 'microphone';
  switch (error?.name) {
    case 'NotAllowedError':
      return `FLASH MEETING chưa được phép sử dụng ${deviceName}.`;
    case 'NotFoundError':
      return `Không tìm thấy ${deviceName}.`;
    case 'NotReadableError':
      return `${deviceName[0].toUpperCase()}${deviceName.slice(1)} đang được ứng dụng khác sử dụng.`;
    case 'OverconstrainedError':
      return `Không thể sử dụng ${deviceName} đã chọn.`;
    default:
      return `Không thể truy cập ${deviceName}. Bạn vẫn có thể tiếp tục mà không bật thiết bị này.`;
  }
}

function updateControlAvailability() {
  const controlsLocked = [
    PREJOIN_STATES.INITIALIZING,
    PREJOIN_STATES.REQUESTING_MEDIA,
    PREJOIN_STATES.JOINING,
    PREJOIN_STATES.SUCCESS,
    PREJOIN_STATES.ERROR
  ].includes(page.dataset.prejoinState);
  const offline = isOffline();
  const mediaAccessSupported = Boolean(navigator.mediaDevices?.getUserMedia);

  const deviceSelectionSupported = Boolean(navigator.mediaDevices?.enumerateDevices);
  cameraSelect.disabled = controlsLocked || !deviceSelectionSupported || state.cameraStatus === MEDIA_STATUS.NO_DEVICE;
  microphoneSelect.disabled = controlsLocked || !deviceSelectionSupported || state.microphoneStatus === MEDIA_STATUS.NO_DEVICE;
  cameraToggle.disabled = controlsLocked || !mediaAccessSupported || state.cameraStatus === MEDIA_STATUS.NO_DEVICE || state.cameraStatus === MEDIA_STATUS.DENIED;
  microphoneToggle.disabled = controlsLocked || !mediaAccessSupported || state.microphoneStatus === MEDIA_STATUS.NO_DEVICE || state.microphoneStatus === MEDIA_STATUS.DENIED;
  submitButton.disabled = controlsLocked || offline || !state.meeting;
}

function setPreviewName(name) {
  previewName.textContent = String(name ?? '').trim() || 'Chưa có tên hiển thị';
}

function updatePreview() {
  const cameraTrack = state.mediaStream?.getVideoTracks()[0];
  if (cameraTrack) state.cameraEnabled = cameraTrack.readyState === 'live' && cameraTrack.enabled;
  const cameraOn = Boolean(state.cameraEnabled && cameraTrack && cameraTrack.readyState === 'live' && cameraTrack.enabled);

  video.hidden = !cameraOn;
  placeholder.hidden = cameraOn;
  cameraState.textContent = cameraOn ? 'Camera đang bật' : 'Camera đang tắt';

  if (state.cameraStatus === MEDIA_STATUS.NO_DEVICE) {
    placeholderTitle.textContent = 'Không tìm thấy camera';
    placeholderCopy.textContent = 'Bạn vẫn có thể tham gia mà không bật camera.';
  } else if (state.cameraStatus === MEDIA_STATUS.DENIED) {
    placeholderTitle.textContent = 'Camera đang tắt';
    placeholderCopy.textContent = 'Bạn vẫn có thể tham gia mà không bật camera.';
  } else {
    placeholderTitle.textContent = cameraOn ? 'Camera đang bật' : 'Camera đang tắt';
    placeholderCopy.textContent = cameraOn ? 'Hình ảnh này chỉ hiển thị trên thiết bị của bạn.' : 'Bạn vẫn có thể tham gia mà không bật camera.';
  }
}

function updateMediaToggle(kind) {
  const isCamera = kind === 'camera';
  const button = isCamera ? cameraToggle : microphoneToggle;
  const track = isCamera ? state.mediaStream?.getVideoTracks()[0] : state.mediaStream?.getAudioTracks()[0];
  const enabled = Boolean(track && track.readyState === 'live' && track.enabled);
  const mediaStatus = isCamera ? state.cameraStatus : state.microphoneStatus;
  const stateElement = document.querySelector(`[data-${kind}-toggle-state]`);
  const iconTarget = document.querySelector(`[data-media-icon="${kind}"]`);

  button.setAttribute('aria-pressed', String(enabled));
  setIcon(iconTarget, enabled ? (isCamera ? 'video' : 'mic') : (isCamera ? 'video-off' : 'mic-off'));
  if (stateElement) {
    stateElement.textContent = mediaStatus === MEDIA_STATUS.NO_DEVICE
      ? 'Không tìm thấy thiết bị'
      : mediaStatus === MEDIA_STATUS.DENIED
        ? 'Chưa được cấp quyền'
        : enabled ? 'Đang bật' : 'Đang tắt';
  }
}

function updateMediaUI() {
  const microphoneTrack = state.mediaStream?.getAudioTracks()[0];
  if (microphoneTrack) state.microphoneEnabled = microphoneTrack.enabled;
  updatePreview();
  updateMediaToggle('camera');
  updateMediaToggle('microphone');
  setDeviceStatus('camera', getDeviceStatusText('camera', state.cameraStatus));
  setDeviceStatus('microphone', getDeviceStatusText('microphone', state.microphoneStatus));
  updateControlAvailability();
}

function setMeetingSummary(meeting) {
  meetingTitle.textContent = meeting.title || 'Cuộc họp FLASH MEETING';
  meetingMeta.textContent = `Mã phòng: ${meeting.roomCode}`;
  meetingSummary.hidden = false;
}

function updateAdmissionCopy() {
  const isHost = Boolean(state.participantContext?.isHost);
  if (prejoinHeading) prejoinHeading.textContent = isHost ? 'Sẵn sàng bắt đầu?' : 'Sẵn sàng tham gia?';
  submitLabel.textContent = isHost ? 'Bắt đầu cuộc họp' : 'Tham gia cuộc họp';
  setIcon(submitIcon, isHost ? 'video' : 'log-in');
}

function replaceTrack(kind, nextStream) {
  const nextTrack = kind === 'camera' ? nextStream.getVideoTracks()[0] : nextStream.getAudioTracks()[0];
  if (!nextTrack) {
    nextStream.getTracks().forEach((track) => track.stop());
    return false;
  }

  if (!state.mediaStream) {
    state.mediaStream = nextStream;
  } else {
    const currentTrack = kind === 'camera' ? state.mediaStream.getVideoTracks()[0] : state.mediaStream.getAudioTracks()[0];
    if (currentTrack) {
      state.mediaStream.removeTrack(currentTrack);
      currentTrack.stop();
    }
    state.mediaStream.addTrack(nextTrack);
  }

  nextTrack.enabled = true;
  video.srcObject = state.mediaStream;
  return true;
}

async function requestTrack(kind, deviceId = '') {
  if (!navigator.mediaDevices?.getUserMedia) {
    const message = 'Trình duyệt này chưa hỗ trợ truy cập thiết bị.';
    if (kind === 'camera') state.cameraStatus = MEDIA_STATUS.NO_DEVICE;
    if (kind === 'microphone') state.microphoneStatus = MEDIA_STATUS.NO_DEVICE;
    setBanner(message, 'error');
    updateMediaUI();
    return false;
  }

  const constraints = kind === 'camera'
    ? { video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false }
    : { video: false, audio: deviceId ? { deviceId: { exact: deviceId } } : true };

  try {
    const nextStream = await navigator.mediaDevices.getUserMedia(constraints);
    const replaced = replaceTrack(kind, nextStream);
    if (!replaced) return false;

    if (kind === 'camera') {
      state.cameraStatus = MEDIA_STATUS.ON;
      state.cameraEnabled = true;
      state.selectedCameraId = nextStream.getVideoTracks()[0].getSettings().deviceId || deviceId;
    } else {
      state.microphoneStatus = MEDIA_STATUS.ON;
      state.microphoneEnabled = true;
      state.selectedMicrophoneId = nextStream.getAudioTracks()[0].getSettings().deviceId || deviceId;
    }
    updateMediaUI();
    return true;
  } catch (error) {
    const mediaStatus = error?.name === 'NotFoundError' ? MEDIA_STATUS.NO_DEVICE : MEDIA_STATUS.DENIED;
    const message = getMediaErrorMessage(kind, error);
    if (kind === 'camera') {
      state.cameraStatus = mediaStatus;
      state.cameraEnabled = false;
    }
    if (kind === 'microphone') {
      state.microphoneStatus = mediaStatus;
      state.microphoneEnabled = false;
    }
    setBanner(message, 'error');
    updateMediaUI();
    return false;
  }
}

function addDeviceOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function populateDeviceSelect(kind, devices) {
  const select = kind === 'camera' ? cameraSelect : microphoneSelect;
  const deviceType = kind === 'camera' ? 'videoinput' : 'audioinput';
  const matchingDevices = devices.filter((device) => device.kind === deviceType);
  const selectedId = kind === 'camera' ? state.selectedCameraId : state.selectedMicrophoneId;

  select.replaceChildren();
  if (!matchingDevices.length) {
    if (kind === 'camera') state.cameraStatus = MEDIA_STATUS.NO_DEVICE;
    if (kind === 'microphone') state.microphoneStatus = MEDIA_STATUS.NO_DEVICE;
    addDeviceOption(select, '', kind === 'camera' ? 'Không tìm thấy camera' : 'Không tìm thấy microphone');
    select.value = '';
    return;
  }

  if (kind === 'camera' && state.cameraStatus === MEDIA_STATUS.NO_DEVICE) state.cameraStatus = MEDIA_STATUS.OFF;
  if (kind === 'microphone' && state.microphoneStatus === MEDIA_STATUS.NO_DEVICE) state.microphoneStatus = MEDIA_STATUS.OFF;

  matchingDevices.forEach((device, index) => {
    addDeviceOption(select, device.deviceId, device.label || `${kind === 'camera' ? 'Camera' : 'Microphone'} ${index + 1}`);
  });

  const nextId = matchingDevices.some((device) => device.deviceId === selectedId)
    ? selectedId
    : matchingDevices[0].deviceId;
  select.value = nextId;
  if (kind === 'camera') state.selectedCameraId = nextId;
  if (kind === 'microphone') state.selectedMicrophoneId = nextId;
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    state.cameraStatus = state.cameraEnabled ? MEDIA_STATUS.NO_DEVICE : MEDIA_STATUS.OFF;
    state.microphoneStatus = state.microphoneEnabled ? MEDIA_STATUS.NO_DEVICE : MEDIA_STATUS.OFF;
    cameraSelect.replaceChildren(new Option('Thiết bị mặc định', ''));
    microphoneSelect.replaceChildren(new Option('Thiết bị mặc định', ''));
    updateMediaUI();
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    populateDeviceSelect('camera', devices);
    populateDeviceSelect('microphone', devices);
    updateMediaUI();
  } catch {
    setBanner('Không thể đọc danh sách thiết bị lúc này.', 'error');
  }
}

function getErrorMessage(code) {
  const messages = {
    [JOIN_MEETING_ERROR_CODES.INVALID_DISPLAY_NAME]: 'Tên hiển thị không hợp lệ. Vui lòng nhập tên từ 2 đến 50 ký tự.',
    [JOIN_MEETING_ERROR_CODES.INVALID_ROOM_CODE]: 'Mã phòng không hợp lệ.',
    [JOIN_MEETING_ERROR_CODES.MEETING_NOT_FOUND]: 'Không tìm thấy cuộc họp với mã phòng này.',
    [JOIN_MEETING_ERROR_CODES.MEETING_ENDED]: 'Cuộc họp đã kết thúc.',
    [JOIN_MEETING_ERROR_CODES.MEETING_CANCELLED]: 'Cuộc họp này đã bị hủy.',
    [JOIN_MEETING_ERROR_CODES.MEETING_LOCKED]: 'Cuộc họp hiện đang bị khóa.',
    [JOIN_MEETING_ERROR_CODES.MEETING_NOT_STARTED]: 'Chủ phòng chưa bắt đầu cuộc họp. Vui lòng thử lại sau.',
    [JOIN_MEETING_ERROR_CODES.ROOM_FULL]: `Cuộc họp đã đủ ${MAX_MEETING_PARTICIPANTS} người tham gia.`,
    [JOIN_MEETING_ERROR_CODES.USER_BLOCKED]: 'Bạn không thể tham gia cuộc họp này.',
    [JOIN_MEETING_ERROR_CODES.NETWORK_ERROR]: 'Không có kết nối Internet. Vui lòng thử lại.',
    [JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE]: 'Dịch vụ tạm thời chưa sẵn sàng. Vui lòng thử lại.',
    [JOIN_MEETING_ERROR_CODES.JOIN_FAILED]: 'Không thể tham gia cuộc họp lúc này. Vui lòng thử lại.'
  };
  return messages[code] ?? messages[JOIN_MEETING_ERROR_CODES.JOIN_FAILED];
}

function showMeetingError(code, { title = 'Không thể tham gia cuộc họp', canRetry = false } = {}) {
  const message = getErrorMessage(code);
  setPrejoinState(canRetry ? PREJOIN_STATES.READY : PREJOIN_STATES.ERROR);
  setFormDisabled(!canRetry);
  form.setAttribute('aria-busy', 'false');
  if (canRetry) submitLabel.textContent = state.participantContext?.isHost ? 'Bắt đầu cuộc họp' : 'Tham gia cuộc họp';
  setBanner(message, 'error');
  setStatusMessage(message, 'error');
  updateControlAvailability();
  modal.error({
    title,
    message,
    retryText: 'Thử lại',
    onRetry: canRetry ? retryPrejoinSubmit : () => window.location.reload()
  });
}

function showStartError() {
  setPrejoinState(PREJOIN_STATES.READY);
  setFormDisabled(false);
  form.setAttribute('aria-busy', 'false');
  updateAdmissionCopy();
  setStatusMessage('Không thể bắt đầu cuộc họp. Vui lòng thử lại.', 'error');
  updateControlAvailability();
  modal.error({
    title: 'Không thể bắt đầu cuộc họp',
    message: 'Vui lòng thử lại.',
    retryText: 'Thử lại',
    onRetry: retryPrejoinSubmit
  });
}

function retryPrejoinSubmit() {
  if (page.dataset.prejoinState === PREJOIN_STATES.ERROR) setPrejoinState(PREJOIN_STATES.READY);
  form?.requestSubmit();
}

function showOfflineState() {
  const offline = isOffline();
  if (offline) {
    setBanner('Bạn đang ngoại tuyến. Kết nối Internet để tham gia cuộc họp.', 'offline');
  } else if (banner?.dataset.state === 'offline') {
    setBanner('');
  }
  updateControlAvailability();
}

function validateDisplayName() {
  const error = form.querySelector('[data-field-error="displayName"]');
  error.textContent = '';
  displayNameInput.removeAttribute('aria-invalid');

  const validation = validateMeetingDisplayName(displayNameInput.value);
  if (!validation.valid) {
    error.textContent = validation.code === 'EMPTY'
      ? 'Vui lòng nhập tên hiển thị.'
      : validation.code === 'LENGTH'
        ? `Tên hiển thị phải có từ ${DISPLAY_NAME_MIN_LENGTH} đến ${DISPLAY_NAME_MAX_LENGTH} ký tự.`
        : 'Tên hiển thị không hợp lệ. Vui lòng nhập tên từ 2 đến 50 ký tự.';
    displayNameInput.setAttribute('aria-invalid', 'true');
    displayNameInput.focus();
    return null;
  }

  displayNameInput.value = validation.value;
  setPreviewName(validation.value);
  return validation.value;
}

function cleanupMedia() {
  state.mediaStream?.getTracks().forEach((track) => track.stop());
  state.mediaStream = null;
  if (video) video.srcObject = null;
}

async function initializeMedia() {
  setPrejoinState(PREJOIN_STATES.REQUESTING_MEDIA);
  form.setAttribute('aria-busy', 'true');
  setStatusMessage('Đang chuẩn bị camera và microphone…');

  if (!navigator.mediaDevices?.getUserMedia) {
    state.cameraStatus = MEDIA_STATUS.NO_DEVICE;
    state.microphoneStatus = MEDIA_STATUS.NO_DEVICE;
    state.cameraEnabled = false;
    state.microphoneEnabled = false;
    setBanner('Trình duyệt này chưa hỗ trợ truy cập thiết bị. Bạn vẫn có thể tiếp tục.', 'error');
  } else {
    await refreshDevices();
    if (state.cameraEnabled) await requestTrack('camera', state.selectedCameraId);
    else if (state.cameraStatus !== MEDIA_STATUS.NO_DEVICE) state.cameraStatus = MEDIA_STATUS.OFF;
    if (state.microphoneEnabled) await requestTrack('microphone', state.selectedMicrophoneId);
    else if (state.microphoneStatus !== MEDIA_STATUS.NO_DEVICE) state.microphoneStatus = MEDIA_STATUS.OFF;
  }

  if (navigator.mediaDevices?.getUserMedia) await refreshDevices();
  setFormDisabled(false);
  form.setAttribute('aria-busy', 'false');
  setPrejoinState(
    state.cameraStatus === MEDIA_STATUS.DENIED || state.microphoneStatus === MEDIA_STATUS.DENIED
      ? PREJOIN_STATES.MEDIA_DENIED
      : state.cameraStatus === MEDIA_STATUS.NO_DEVICE && state.microphoneStatus === MEDIA_STATUS.NO_DEVICE
        ? PREJOIN_STATES.NO_DEVICE
        : PREJOIN_STATES.READY
  );
  setStatusMessage('Bạn có thể điều chỉnh thiết bị trước khi tham gia.');
  showOfflineState();
  updateMediaUI();
}

async function handleDeviceChange(kind, event) {
  const nextId = event.target.value;
  const previousId = kind === 'camera' ? state.selectedCameraId : state.selectedMicrophoneId;
  event.target.disabled = true;
  setDeviceStatus(kind, 'Đang chuyển thiết bị…');
  const changed = await requestTrack(kind, nextId);
  if (!changed) event.target.value = previousId;
  await refreshDevices();
  persistMediaPreferences();
  updateControlAvailability();
}

async function toggleMedia(kind) {
  const track = kind === 'camera'
    ? state.mediaStream?.getVideoTracks()[0]
    : state.mediaStream?.getAudioTracks()[0];
  const enabled = kind === 'camera' ? state.cameraEnabled : state.microphoneEnabled;
  if (enabled) {
    if (track) track.enabled = false;
    if (kind === 'camera') {
      state.cameraEnabled = false;
      state.cameraStatus = MEDIA_STATUS.OFF;
    } else {
      state.microphoneEnabled = false;
      state.microphoneStatus = MEDIA_STATUS.OFF;
    }
  } else if (track) {
    track.enabled = true;
    if (kind === 'camera') {
      state.cameraEnabled = true;
      state.cameraStatus = MEDIA_STATUS.ON;
    } else {
      state.microphoneEnabled = true;
      state.microphoneStatus = MEDIA_STATUS.ON;
    }
  } else {
    await requestTrack(kind, kind === 'camera' ? state.selectedCameraId : state.selectedMicrophoneId);
  }
  persistMediaPreferences();
  updateMediaUI();
}

async function loadMeeting() {
  state.roomCode = getRoomCodeFromUrl();
  if (!state.roomCode) {
    showMeetingError(JOIN_MEETING_ERROR_CODES.INVALID_ROOM_CODE);
    return false;
  }

  const storedDisplayName = getStoredDisplayName();
  if (!storedDisplayName) {
    redirectToJoin();
    return false;
  }
  displayNameInput.value = storedDisplayName;
  let result;
  try {
    result = await meetingService.resolveForJoin({
      roomCode: state.roomCode,
      displayName: displayNameInput.value,
      phase: 'load'
    });
  } catch {
    result = { success: false, code: JOIN_MEETING_ERROR_CODES.NETWORK_ERROR };
  }
  if (!result.success) {
    showMeetingError(result.code, { title: 'Không thể mở cuộc họp' });
    return false;
  }

  state.meeting = result.meeting;
  state.participantContext = result.participantContext
    || meetingService.getCurrentParticipantContext(state.roomCode, result.meeting);
  setMeetingSummary(result.meeting);
  updateAdmissionCopy();
  return true;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (![PREJOIN_STATES.READY, PREJOIN_STATES.MEDIA_DENIED, PREJOIN_STATES.NO_DEVICE].includes(page.dataset.prejoinState)) return;

  const displayName = validateDisplayName();
  if (!displayName) return;
  if (isOffline()) {
    showMeetingError(JOIN_MEETING_ERROR_CODES.NETWORK_ERROR, { canRetry: true });
    return;
  }

  setPrejoinState(PREJOIN_STATES.JOINING);
  setFormDisabled(true);
  form.setAttribute('aria-busy', 'true');
  const isHost = Boolean(state.participantContext?.isHost);
  submitLabel.textContent = isHost ? 'Đang bắt đầu cuộc họp…' : 'Đang kiểm tra cuộc họp…';
  setStatusMessage(isHost ? 'Đang mở phòng họp của bạn…' : 'Đang xác nhận thông tin cuộc họp…');
  modal.processing({
    title: isHost ? 'Đang bắt đầu cuộc họp' : 'Đang tham gia cuộc họp',
    message: isHost ? 'Đang mở phòng họp của bạn.' : 'Đang xác nhận thông tin cuộc họp.'
  });

  let result;
  try {
    result = isHost
      ? await meetingService.startMeeting({ roomCode: state.roomCode, displayName })
      : await meetingService.resolveForJoin({
        roomCode: state.roomCode,
        displayName,
        phase: 'join'
      });
  } catch {
    result = { success: false, code: isHost ? START_MEETING_ERROR_CODES.START_MEETING_FAILED : JOIN_MEETING_ERROR_CODES.JOIN_FAILED };
  }
  if (!result.success) {
    if (isHost && result.code !== START_MEETING_ERROR_CODES.INVALID_DISPLAY_NAME
      && Object.values(START_MEETING_ERROR_CODES).includes(result.code)) {
      showStartError();
    } else {
      setFormDisabled(false);
      showMeetingError(result.code, { canRetry: true });
    }
    return;
  }

  state.meeting = result.meeting;
  state.participantContext = result.participantContext
    || meetingService.getCurrentParticipantContext(state.roomCode, result.meeting);
  const participantValidation = validateMeetingDisplayName(result.participant?.displayName);
  if (!participantValidation.valid) {
    setFormDisabled(false);
    showMeetingError(JOIN_MEETING_ERROR_CODES.INVALID_DISPLAY_NAME, { canRetry: true });
    return;
  }
  result.participant.displayName = participantValidation.value;
  setPrejoinState(PREJOIN_STATES.SUCCESS);
  setStatusMessage(isHost ? 'Cuộc họp đã bắt đầu. Đang mở phòng…' : 'Đã sẵn sàng. Đang mở cuộc họp…', 'success');
  sessionStorage.setItem('flashMeeting.roomCode', result.meeting.roomCode);
  sessionStorage.setItem('flashMeeting.displayName', result.participant.displayName);
  sessionStorage.setItem('flashMeeting.joinedMeeting', JSON.stringify(result.meeting));
  sessionStorage.setItem('flashMeeting.joinedParticipant', JSON.stringify(result.participant));
  persistMediaPreferences();
  cleanupMedia();

  const destination = meetingService.getAdmissionDestination(state.participantContext);
  const nextPage = destination === 'waiting-room' ? 'waiting-room.html' : 'meeting.html';
  await wait(REDIRECT_DELAY);
  window.location.href = `${getPageUrl(nextPage)}?room=${encodeURIComponent(result.meeting.roomCode)}`;
}

function bindEvents() {
  form?.addEventListener('submit', handleSubmit);
  cameraSelect?.addEventListener('change', (event) => handleDeviceChange('camera', event));
  microphoneSelect?.addEventListener('change', (event) => handleDeviceChange('microphone', event));
  cameraToggle?.addEventListener('click', () => toggleMedia('camera'));
  microphoneToggle?.addEventListener('click', () => toggleMedia('microphone'));
  displayNameInput?.addEventListener('input', () => {
    setPreviewName(displayNameInput.value);
    const error = form.querySelector('[data-field-error="displayName"]');
    error.textContent = '';
    displayNameInput.removeAttribute('aria-invalid');
  });
  window.addEventListener('offline', showOfflineState);
  window.addEventListener('online', showOfflineState);
  window.addEventListener('pagehide', cleanupMedia);
  window.addEventListener('beforeunload', cleanupMedia);
  navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
}

async function initialize() {
  bindEvents();
  setFormDisabled(true);
  setPreviewName('');
  setPrejoinState(PREJOIN_STATES.INITIALIZING);
  const sessionResult = await protectPage();
  if (!sessionResult.success || !sessionResult.session) return;
  const meetingLoaded = await loadMeeting();
  if (!meetingLoaded) return;
  applyStoredMediaPreferences();
  setPreviewName(displayNameInput.value);
  await initializeMedia();
}

registerAuthExpiryCleanup(cleanupMedia);
initialize();
