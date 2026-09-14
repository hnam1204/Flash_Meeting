export const RECORDING_STATES = Object.freeze({
  IDLE: 'IDLE',
  STARTING: 'STARTING',
  RECORDING: 'RECORDING',
  PAUSED: 'PAUSED',
  STOPPING: 'STOPPING',
  READY: 'READY',
  ERROR: 'ERROR'
});

const RECORDING_WIDTH = 1280;
const RECORDING_HEIGHT = 720;
const RECORDING_FPS = 30;
const RECORDING_TIMESLICE = 2000;
const MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
];

function isLiveTrack(stream, kind) {
  const track = kind === 'audio'
    ? stream?.getAudioTracks?.()[0]
    : stream?.getVideoTracks?.()[0];
  return Boolean(track && track.readyState === 'live');
}

function getSafeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('');
}

export function createMeetingRecordingController({ roomCode, getScene, onStateChange } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = RECORDING_WIDTH;
  canvas.height = RECORDING_HEIGHT;
  const context = canvas.getContext('2d');
  const cameraVideo = document.createElement('video');
  const screenVideo = document.createElement('video');
  cameraVideo.autoplay = true;
  cameraVideo.muted = true;
  cameraVideo.playsInline = true;
  screenVideo.autoplay = true;
  screenVideo.muted = true;
  screenVideo.playsInline = true;

  let status = RECORDING_STATES.IDLE;
  let recorder = null;
  let startedAt = 0;
  let chunks = [];
  let outputStream = null;
  let mimeType = '';
  let blob = null;
  let filename = '';
  let frameHandle = 0;
  let lastFrameAt = 0;
  let recordingDuration = 0;
  let stopPromise = null;
  let stopResolver = null;
  let fatalError = false;
  let errorMessage = '';
  let objectUrl = '';
  let supportChecked = false;
  let supported = false;

  function isSupported() {
    if (supportChecked) return supported;
    supportChecked = true;
    if (typeof window === 'undefined' || typeof window.MediaRecorder !== 'function' || !canvas.captureStream || !context) return false;
    try {
      const testStream = canvas.captureStream(RECORDING_FPS);
      supported = testStream.getVideoTracks().length > 0;
      testStream.getTracks().forEach((track) => track.stop());
    } catch {
      supported = false;
    }
    return supported;
  }

  function getDuration() {
    if (!startedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  }

  function getState() {
    return {
      status,
      recorder,
      startedAt,
      duration: status === RECORDING_STATES.RECORDING || status === RECORDING_STATES.STARTING || status === RECORDING_STATES.STOPPING
        ? getDuration()
        : recordingDuration,
      mimeType,
      hasReadyRecording: Boolean(blob && status === RECORDING_STATES.READY),
      filename,
      errorMessage,
      supported: isSupported()
    };
  }

  function notify() {
    onStateChange?.(getState());
  }

  function clearObjectUrl() {
    if (!objectUrl) return;
    URL.revokeObjectURL(objectUrl);
    objectUrl = '';
  }

  function stopFrameLoop() {
    if (!frameHandle) return;
    window.cancelAnimationFrame(frameHandle);
    frameHandle = 0;
    lastFrameAt = 0;
  }

  function stopOutputStream() {
    outputStream?.getVideoTracks?.().forEach((track) => track.stop());
    outputStream = null;
  }

  function clearVideoSource(video) {
    video.pause?.();
    video.srcObject = null;
  }

  function disposeRuntime() {
    stopFrameLoop();
    stopOutputStream();
    clearVideoSource(cameraVideo);
    clearVideoSource(screenVideo);
    recorder = null;
  }

  function setStatus(nextStatus, nextMessage = '') {
    status = nextStatus;
    errorMessage = nextMessage;
    notify();
  }

  function setVideoSource(video, stream) {
    if (video.srcObject !== stream) {
      video.srcObject = stream || null;
      if (stream) video.play().catch(() => {});
    } else if (stream && video.paused) {
      video.play().catch(() => {});
    }
  }

  function isVideoReady(video) {
    return Boolean(video?.srcObject && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0);
  }

  function drawCover(video, x, y, width, height) {
    if (!isVideoReady(video)) return false;
    const sourceWidth = video.videoWidth || 16;
    const sourceHeight = video.videoHeight || 9;
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    context.drawImage(
      video,
      x + (width - drawWidth) / 2,
      y + (height - drawHeight) / 2,
      drawWidth,
      drawHeight
    );
    return true;
  }

  function drawContain(video, x, y, width, height) {
    if (!isVideoReady(video)) return false;
    const sourceWidth = video.videoWidth || 16;
    const sourceHeight = video.videoHeight || 9;
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    context.drawImage(video, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
    return true;
  }

  function drawFallback(scene, presentation = false) {
    const gradient = context.createLinearGradient(0, 0, RECORDING_WIDTH, RECORDING_HEIGHT);
    gradient.addColorStop(0, presentation ? '#1c1917' : '#26323a');
    gradient.addColorStop(1, presentation ? '#34251d' : '#182b2c');
    context.fillStyle = gradient;
    context.fillRect(0, 0, RECORDING_WIDTH, RECORDING_HEIGHT);

    const initials = getSafeText(scene.initials, '?').slice(0, 3).toUpperCase();
    context.beginPath();
    context.arc(RECORDING_WIDTH / 2, RECORDING_HEIGHT / 2 - 12, 82, 0, Math.PI * 2);
    context.fillStyle = '#f06d20';
    context.fill();
    context.fillStyle = '#ffffff';
    context.font = '700 64px "Be Vietnam Pro", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(initials, RECORDING_WIDTH / 2, RECORDING_HEIGHT / 2 - 12);
  }

  function drawOverlay(scene, presentation) {
    const footer = context.createLinearGradient(0, RECORDING_HEIGHT - 150, 0, RECORDING_HEIGHT);
    footer.addColorStop(0, 'rgba(12, 10, 9, 0)');
    footer.addColorStop(1, 'rgba(12, 10, 9, .86)');
    context.fillStyle = footer;
    context.fillRect(0, RECORDING_HEIGHT - 150, RECORDING_WIDTH, 150);

    context.fillStyle = 'rgba(12, 10, 9, .70)';
    context.fillRect(28, 24, 280, 40);
    context.fillStyle = '#ffd0ad';
    context.font = '600 18px "Be Vietnam Pro", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText(`FLASH MEETING  ·  ${getSafeText(scene.roomCode, roomCode)}`, 42, 44);

    context.fillStyle = '#ffffff';
    context.font = '600 26px "Be Vietnam Pro", sans-serif';
    context.fillText(getSafeText(scene.displayName, 'Thành viên'), 34, RECORDING_HEIGHT - 58);
    context.fillStyle = '#d5d0ca';
    context.font = '400 17px "Be Vietnam Pro", sans-serif';
    context.fillText(presentation ? 'Đang trình bày' : getSafeText(scene.cameraEnabled ? 'Camera đang bật' : 'Camera đang tắt'), 34, RECORDING_HEIGHT - 29);
  }

  function renderFrame(timestamp = 0) {
    if (status !== RECORDING_STATES.RECORDING && status !== RECORDING_STATES.STARTING && status !== RECORDING_STATES.STOPPING) return;
    if (timestamp - lastFrameAt < 1000 / RECORDING_FPS) {
      frameHandle = window.requestAnimationFrame(renderFrame);
      return;
    }
    lastFrameAt = timestamp;
    const scene = getScene?.() || {};
    const presentation = Boolean(scene.presentation && scene.screenStream && isLiveTrack(scene.screenStream, 'video'));
    const cameraReady = Boolean(scene.cameraEnabled && isLiveTrack(scene.cameraStream, 'video'));
    setVideoSource(cameraVideo, cameraReady ? scene.cameraStream : null);
    setVideoSource(screenVideo, presentation ? scene.screenStream : null);

    context.fillStyle = '#0e0d0c';
    context.fillRect(0, 0, RECORDING_WIDTH, RECORDING_HEIGHT);
    if (presentation) {
      const hasScreen = drawContain(screenVideo, 0, 0, RECORDING_WIDTH, RECORDING_HEIGHT);
      if (!hasScreen) drawFallback(scene, true);
      if (cameraReady && isVideoReady(cameraVideo)) {
        const pipWidth = 230;
        const pipHeight = 140;
        const pipX = RECORDING_WIDTH - pipWidth - 30;
        const pipY = RECORDING_HEIGHT - pipHeight - 34;
        context.save();
        context.shadowColor = 'rgba(0, 0, 0, .40)';
        context.shadowBlur = 22;
        context.fillStyle = '#0e0d0c';
        context.fillRect(pipX - 4, pipY - 4, pipWidth + 8, pipHeight + 8);
        context.restore();
        drawCover(cameraVideo, pipX, pipY, pipWidth, pipHeight);
      }
    } else if (!cameraReady || !drawCover(cameraVideo, 0, 0, RECORDING_WIDTH, RECORDING_HEIGHT)) {
      drawFallback(scene, false);
    }
    drawOverlay(scene, presentation);
    frameHandle = window.requestAnimationFrame(renderFrame);
  }

  function startFrameLoop() {
    stopFrameLoop();
    frameHandle = window.requestAnimationFrame(renderFrame);
  }

  function chooseMimeType() {
    if (typeof window.MediaRecorder.isTypeSupported !== 'function') return '';
    return MIME_TYPES.find((candidate) => {
      try { return window.MediaRecorder.isTypeSupported(candidate); } catch { return false; }
    }) || '';
  }

  function completeStop() {
    disposeRuntime();
    recordingDuration = getDuration();
    const result = { success: false, blob: null, duration: recordingDuration, mimeType };
    if (!fatalError && chunks.length) {
      blob = new Blob(chunks, { type: mimeType || 'video/webm' });
      filename = `flash-meeting-${getSafeText(roomCode, 'room').replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-${formatTimestamp()}.webm`;
      status = RECORDING_STATES.READY;
      errorMessage = '';
      result.success = true;
      result.blob = blob;
    } else {
      blob = null;
      chunks = [];
      status = RECORDING_STATES.ERROR;
      errorMessage = errorMessage || 'Không thể hoàn tất bản ghi.';
    }
    notify();
    stopResolver?.(result);
    stopResolver = null;
    stopPromise = null;
    return result;
  }

  function handleRecorderError() {
    fatalError = true;
    errorMessage = 'Không thể hoàn tất bản ghi.';
    if (recorder?.state === 'recording' || recorder?.state === 'paused') {
      try { recorder.stop(); } catch { completeStop(); }
    } else {
      completeStop();
    }
  }

  function clearReadyRecording() {
    clearObjectUrl();
    blob = null;
    chunks = [];
    filename = '';
    startedAt = 0;
    recordingDuration = 0;
    mimeType = '';
    errorMessage = '';
    if (status === RECORDING_STATES.READY || status === RECORDING_STATES.ERROR) {
      status = RECORDING_STATES.IDLE;
      notify();
    }
  }

  async function start() {
    if (!isSupported()) {
      setStatus(RECORDING_STATES.ERROR, 'Trình duyệt này chưa hỗ trợ ghi hình cuộc họp.');
      return { success: false, code: 'UNSUPPORTED' };
    }
    if ([RECORDING_STATES.STARTING, RECORDING_STATES.RECORDING, RECORDING_STATES.STOPPING].includes(status)) {
      return { success: false, code: 'ALREADY_ACTIVE' };
    }

    clearReadyRecording();
    status = RECORDING_STATES.STARTING;
    fatalError = false;
    errorMessage = '';
    startedAt = Date.now();
    recordingDuration = 0;
    chunks = [];
    mimeType = chooseMimeType();
    try {
      outputStream = canvas.captureStream(RECORDING_FPS);
      const microphoneStream = getScene?.()?.microphoneStream;
      const microphoneTrack = isLiveTrack(microphoneStream, 'audio') ? microphoneStream.getAudioTracks()[0] : null;
      if (microphoneTrack && outputStream.addTrack) outputStream.addTrack(microphoneTrack);
      recorder = mimeType
        ? new window.MediaRecorder(outputStream, { mimeType })
        : new window.MediaRecorder(outputStream);
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };
      recorder.onerror = handleRecorderError;
      recorder.onstop = completeStop;
      recorder.start(RECORDING_TIMESLICE);
      status = RECORDING_STATES.RECORDING;
      startFrameLoop();
      notify();
      return { success: true, mimeType };
    } catch {
      disposeRuntime();
      status = RECORDING_STATES.ERROR;
      errorMessage = 'Không thể bắt đầu ghi hình.';
      notify();
      return { success: false, code: 'START_FAILED' };
    }
  }

  function stop() {
    if (status === RECORDING_STATES.IDLE) return Promise.resolve({ success: false, code: 'NOT_ACTIVE' });
    if (status === RECORDING_STATES.READY) return Promise.resolve({ success: true, blob });
    if (stopPromise) return stopPromise;
    if (status === RECORDING_STATES.ERROR && !recorder) return Promise.resolve({ success: false, code: 'ERROR' });

    status = RECORDING_STATES.STOPPING;
    notify();
    stopPromise = new Promise((resolve) => {
      stopResolver = resolve;
      if (!recorder || recorder.state === 'inactive') {
        completeStop();
        return;
      }
      try { recorder.stop(); } catch { completeStop(); }
    });
    return stopPromise;
  }

  function save() {
    if (!blob || status !== RECORDING_STATES.READY) return false;
    try {
      clearObjectUrl();
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename || `flash-meeting-${formatTimestamp()}.webm`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      const savedUrl = objectUrl;
      window.setTimeout(() => {
        URL.revokeObjectURL(savedUrl);
        if (objectUrl === savedUrl) objectUrl = '';
      }, 1000);
    } catch {
      clearObjectUrl();
      return false;
    }
    blob = null;
    chunks = [];
    filename = '';
    startedAt = 0;
    recordingDuration = 0;
    mimeType = '';
    status = RECORDING_STATES.IDLE;
    notify();
    return true;
  }

  async function cleanup({ finalize = true } = {}) {
    if (status === RECORDING_STATES.STARTING || status === RECORDING_STATES.RECORDING || status === RECORDING_STATES.PAUSED || status === RECORDING_STATES.STOPPING) {
      if (finalize) await stop();
      else {
        fatalError = true;
        if (recorder) {
          recorder.onstop = null;
          recorder.onerror = null;
          try { recorder.stop?.(); } catch { /* Page cleanup is best effort. */ }
        }
        disposeRuntime();
        status = RECORDING_STATES.IDLE;
        chunks = [];
        notify();
      }
    }
    clearReadyRecording();
  }

  return {
    getState,
    isSupported,
    isActive: () => [RECORDING_STATES.STARTING, RECORDING_STATES.RECORDING, RECORDING_STATES.PAUSED, RECORDING_STATES.STOPPING].includes(status),
    hasReadyRecording: () => Boolean(blob && status === RECORDING_STATES.READY),
    start,
    stop,
    save,
    cleanup,
    clearReadyRecording
  };
}
