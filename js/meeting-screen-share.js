let screenStream = null;
let screenTrack = null;
let remotePresenter = null;
let startInProgress = false;
const listeners = new Set();

function notify(reason = 'updated') {
  const state = {
    active: Boolean(screenStream || remotePresenter),
    presenterId: screenStream ? 'local' : remotePresenter?.id ?? null,
    isLocalPresenter: Boolean(screenStream),
    stream: screenStream,
    reason
  };
  listeners.forEach((listener) => listener(state));
}

function clearLocalShare(reason = 'stopped', shouldNotify = true) {
  const stream = screenStream;
  const track = screenTrack;
  screenTrack = null;
  screenStream = null;
  if (track) track.onended = null;
  stream?.getTracks().forEach((item) => {
    if (item.readyState !== 'ended') item.stop();
  });
  if (shouldNotify) notify(reason);
}

function getFailureReason(error) {
  if (error?.name === 'AbortError') return 'CANCELLED';
  if (error?.name === 'NotAllowedError') return 'DENIED';
  if (error?.name === 'NotFoundError') return 'NO_SOURCE';
  if (error?.name === 'NotReadableError') return 'SOURCE_BUSY';
  return 'FAILED';
}

export function isScreenShareSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export function getScreenShareState() {
  return {
    active: Boolean(screenStream || remotePresenter),
    presenterId: screenStream ? 'local' : remotePresenter?.id ?? null,
    isLocalPresenter: Boolean(screenStream)
  };
}

export function subscribeScreenShare(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function startScreenShare() {
  if (screenStream || startInProgress) return { started: false, reason: 'ALREADY_ACTIVE' };
  if (remotePresenter) return { started: false, reason: 'REMOTE_ACTIVE' };
  if (!isScreenShareSupported()) return { started: false, reason: 'UNSUPPORTED' };

  startInProgress = true;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      return { started: false, reason: 'NO_SOURCE' };
    }

    screenStream = stream;
    screenTrack = track;
    track.onended = () => clearLocalShare('browser-stopped');
    notify('started');
    return { started: true, stream, track };
  } catch (error) {
    return { started: false, reason: getFailureReason(error) };
  } finally {
    startInProgress = false;
  }
}

export async function stopScreenShare() {
  if (!screenStream) return { stopped: false, reason: remotePresenter ? 'NOT_LOCAL_PRESENTER' : 'NOT_ACTIVE' };
  clearLocalShare('stopped');
  return { stopped: true };
}

export function startMockRemoteShare({ id, name } = {}) {
  if (screenStream || remotePresenter || startInProgress) return { started: false, reason: 'ALREADY_ACTIVE' };
  remotePresenter = { id: String(id || 'participant-1'), name: String(name || 'Minh Anh') };
  notify('remote-started');
  return { started: true };
}

export function stopMockRemoteShare() {
  if (!remotePresenter) return { stopped: false, reason: 'NOT_ACTIVE' };
  remotePresenter = null;
  notify('remote-stopped');
  return { stopped: true };
}

export function cleanupScreenShare() {
  const hadState = Boolean(screenStream || remotePresenter);
  clearLocalShare('cleanup', false);
  remotePresenter = null;
  if (hadState) notify('cleanup');
}
