import { authService } from './auth-service.js';
import {
  JOIN_MEETING_ERROR_CODES,
  MAX_MEETING_PARTICIPANTS,
  meetingService
} from './meeting-service.js';
import {
  getPageUrl,
  isLikelyRoomCode,
  normalizeRoomCode,
  readStoredRoomCode,
  setStatus
} from './utils.js';

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

const DISPLAY_NAME_MIN_LENGTH = 2;
const DISPLAY_NAME_MAX_LENGTH = 50;
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
const submitButton = document.querySelector('[data-prejoin-submit]');
const submitLabel = document.querySelector('[data-prejoin-submit-label]');
const cameraSelect = document.querySelector('[data-device-select="camera"]');
const microphoneSelect = document.querySelector('[data-device-select="microphone"]');
const cameraToggle = document.querySelector('[data-media-toggle="camera"]');
const microphoneToggle = document.querySelector('[data-media-toggle="microphone"]');

const state = {
  roomCode: '',
  meeting: null,
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

function isOffline() {
  const scenario = new URLSearchParams(window.location.search).get('mock')?.toLowerCase();
  return scenario === 'offline' || navigator.onLine === false;
}

function getStoredDisplayName() {
  const storedName = sessionStorage.getItem('flashMeeting.displayName')?.trim();
  if (storedName) return storedName;

  const sessionName = authService.getSession()?.displayName?.trim();
  return sessionName || 'Khách tham gia';
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
  const hasCameraTrack = Boolean(state.mediaStream?.getVideoTracks().length);
  const hasMicrophoneTrack = Boolean(state.mediaStream?.getAudioTracks().length);

  cameraSelect.disabled = controlsLocked || state.cameraStatus === MEDIA_STATUS.NO_DEVICE;
  microphoneSelect.disabled = controlsLocked || state.microphoneStatus === MEDIA_STATUS.NO_DEVICE;
  cameraToggle.disabled = controlsLocked || !hasCameraTrack || state.cameraStatus === MEDIA_STATUS.DENIED;
  microphoneToggle.disabled = controlsLocked || !hasMicrophoneTrack || state.microphoneStatus === MEDIA_STATUS.DENIED;
  submitButton.disabled = controlsLocked || offline || !state.meeting;
}

function setPreviewName(name) {
  const safeName = String(name ?? '').trim() || 'Khách tham gia';
  previewName.textContent = safeName;
}

function updatePreview() {
  const cameraTrack = state.mediaStream?.getVideoTracks()[0];
  const cameraOn = Boolean(cameraTrack && cameraTrack.readyState === 'live' && cameraTrack.enabled);
  state.cameraEnabled = cameraOn;

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

  button.setAttribute('aria-pressed', String(enabled));
  if (stateElement) {
    stateElement.textContent = mediaStatus === MEDIA_STATUS.NO_DEVICE
      ? 'Không tìm thấy thiết bị'
      : mediaStatus === MEDIA_STATUS.DENIED
        ? 'Chưa được cấp quyền'
        : enabled ? 'Đang bật' : 'Đang tắt';
  }
}

function updateMediaUI() {
  state.microphoneEnabled = Boolean(state.mediaStream?.getAudioTracks()[0]?.enabled);
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
      state.selectedCameraId = nextStream.getVideoTracks()[0].getSettings().deviceId || deviceId;
    } else {
      state.microphoneStatus = MEDIA_STATUS.ON;
      state.selectedMicrophoneId = nextStream.getAudioTracks()[0].getSettings().deviceId || deviceId;
    }
    updateMediaUI();
    return true;
  } catch (error) {
    const mediaStatus = error?.name === 'NotFoundError' ? MEDIA_STATUS.NO_DEVICE : MEDIA_STATUS.DENIED;
    const message = getMediaErrorMessage(kind, error);
    if (kind === 'camera') state.cameraStatus = mediaStatus;
    if (kind === 'microphone') state.microphoneStatus = mediaStatus;
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
    populateDeviceSelect('camera', []);
    populateDeviceSelect('microphone', []);
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
    [JOIN_MEETING_ERROR_CODES.INVALID_ROOM_CODE]: 'Mã phòng không hợp lệ.',
    [JOIN_MEETING_ERROR_CODES.MEETING_NOT_FOUND]: 'Không tìm thấy cuộc họp với mã phòng này.',
    [JOIN_MEETING_ERROR_CODES.MEETING_ENDED]: 'Cuộc họp đã kết thúc.',
    [JOIN_MEETING_ERROR_CODES.MEETING_CANCELLED]: 'Cuộc họp này đã bị hủy.',
    [JOIN_MEETING_ERROR_CODES.MEETING_LOCKED]: 'Cuộc họp hiện đang bị khóa.',
    [JOIN_MEETING_ERROR_CODES.ROOM_FULL]: `Cuộc họp đã đủ ${MAX_MEETING_PARTICIPANTS} người tham gia.`,
    [JOIN_MEETING_ERROR_CODES.USER_BLOCKED]: 'Bạn không thể tham gia cuộc họp này.',
    [JOIN_MEETING_ERROR_CODES.NETWORK_ERROR]: 'Không có kết nối Internet. Vui lòng thử lại.',
    [JOIN_MEETING_ERROR_CODES.SERVICE_UNAVAILABLE]: 'Dịch vụ tạm thời chưa sẵn sàng. Vui lòng thử lại.',
    [JOIN_MEETING_ERROR_CODES.JOIN_FAILED]: 'Không thể tham gia cuộc họp lúc này. Vui lòng thử lại.'
  };
  return messages[code] ?? messages[JOIN_MEETING_ERROR_CODES.JOIN_FAILED];
}

function showMeetingError(code) {
  const message = getErrorMessage(code);
  setPrejoinState(PREJOIN_STATES.ERROR);
  setFormDisabled(true);
  form.setAttribute('aria-busy', 'false');
  setBanner(message, 'error');
  setStatusMessage(message, 'error');
  updateControlAvailability();
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
  const rawName = String(displayNameInput.value ?? '');
  const displayName = rawName.trim();
  const error = form.querySelector('[data-field-error="displayName"]');
  error.textContent = '';
  displayNameInput.removeAttribute('aria-invalid');

  if (rawName.length > 0 && !displayName) {
    error.textContent = 'Tên hiển thị không hợp lệ.';
    displayNameInput.setAttribute('aria-invalid', 'true');
    displayNameInput.focus();
    return null;
  }
  if (!displayName) {
    displayNameInput.value = 'Khách tham gia';
    setPreviewName(displayNameInput.value);
    return displayNameInput.value;
  }
  if (displayName.length < DISPLAY_NAME_MIN_LENGTH || displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    error.textContent = `Tên hiển thị phải có từ ${DISPLAY_NAME_MIN_LENGTH} đến ${DISPLAY_NAME_MAX_LENGTH} ký tự.`;
    displayNameInput.setAttribute('aria-invalid', 'true');
    displayNameInput.focus();
    return null;
  }

  return displayName;
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
    setBanner('Trình duyệt này chưa hỗ trợ truy cập thiết bị. Bạn vẫn có thể tiếp tục.', 'error');
  } else {
    await requestTrack('camera', state.selectedCameraId);
    await requestTrack('microphone', state.selectedMicrophoneId);
  }

  await refreshDevices();
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
  updateControlAvailability();
}

function toggleMedia(kind) {
  const track = kind === 'camera'
    ? state.mediaStream?.getVideoTracks()[0]
    : state.mediaStream?.getAudioTracks()[0];
  if (!track) return;

  track.enabled = !track.enabled;
  if (kind === 'camera') state.cameraEnabled = track.enabled;
  if (kind === 'microphone') state.microphoneEnabled = track.enabled;
  updateMediaUI();
}

async function loadMeeting() {
  state.roomCode = getRoomCodeFromUrl();
  if (!state.roomCode) {
    showMeetingError(JOIN_MEETING_ERROR_CODES.INVALID_ROOM_CODE);
    return false;
  }

  displayNameInput.value = getStoredDisplayName();
  const result = await meetingService.resolveForJoin({
    roomCode: state.roomCode,
    displayName: displayNameInput.value,
    phase: 'load'
  });
  if (!result.success) {
    showMeetingError(result.code);
    return false;
  }

  state.meeting = result.meeting;
  setMeetingSummary(result.meeting);
  return true;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (![PREJOIN_STATES.READY, PREJOIN_STATES.MEDIA_DENIED, PREJOIN_STATES.NO_DEVICE].includes(page.dataset.prejoinState)) return;

  const displayName = validateDisplayName();
  if (!displayName) return;
  if (isOffline()) {
    showMeetingError(JOIN_MEETING_ERROR_CODES.NETWORK_ERROR);
    return;
  }

  setPrejoinState(PREJOIN_STATES.JOINING);
  setFormDisabled(true);
  form.setAttribute('aria-busy', 'true');
  submitLabel.textContent = 'Đang kiểm tra cuộc họp…';
  setStatusMessage('Đang xác nhận thông tin cuộc họp…');

  const result = await meetingService.resolveForJoin({
    roomCode: state.roomCode,
    displayName,
    phase: 'join'
  });
  if (!result.success) {
    setFormDisabled(false);
    showMeetingError(result.code);
    return;
  }

  state.meeting = result.meeting;
  setPrejoinState(PREJOIN_STATES.SUCCESS);
  setStatusMessage('Đã sẵn sàng. Đang mở cuộc họp…', 'success');
  sessionStorage.setItem('flashMeeting.roomCode', result.meeting.roomCode);
  sessionStorage.setItem('flashMeeting.displayName', result.participant.displayName);
  sessionStorage.setItem('flashMeeting.joinedMeeting', JSON.stringify(result.meeting));
  cleanupMedia();

  const nextPage = result.meeting.waitingRoomEnabled ? 'waiting-room.html' : 'meeting.html';
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
  setPreviewName('Khách tham gia');
  setPrejoinState(PREJOIN_STATES.INITIALIZING);
  const meetingLoaded = await loadMeeting();
  if (!meetingLoaded) return;
  setPreviewName(displayNameInput.value);
  await initializeMedia();
}

initialize();
