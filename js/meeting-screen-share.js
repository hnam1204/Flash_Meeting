export const SCREEN_SHARE_STATES = Object.freeze({
  IDLE: 'IDLE',
  REQUESTING: 'REQUESTING',
  LIVE: 'LIVE',
  STOPPING: 'STOPPING',
  ERROR: 'ERROR'
});

let screenStream = null;
let screenTrack = null;
let screenSettings = null;
let remotePresenter = null;
let shareStatus = SCREEN_SHARE_STATES.IDLE;
let startInProgress = false;
let stopInProgress = false;
let startRequestId = 0;
let activeStartRequestId = 0;
const listeners = new Set();

function getTrackSettings(track) {
  const settings = track?.getSettings?.() || {};
  const numberOrNull = (value) => value === null || value === undefined || value === ''
    ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    width: numberOrNull(settings.width),
    height: numberOrNull(settings.height),
    displaySurface: String(settings.displaySurface || ''),
    frameRate: numberOrNull(settings.frameRate)
  };
}

function getStateSnapshot(reason = 'updated') {
  return {
    active: Boolean(screenStream || remotePresenter),
    presenterId: screenStream ? 'local' : remotePresenter?.id ?? null,
    isLocalPresenter: Boolean(screenStream),
    stream: screenStream,
    track: screenTrack,
    settings: screenSettings,
    status: shareStatus,
    reason
  };
}

function notify(reason = 'updated') {
  const state = getStateSnapshot(reason);
  listeners.forEach((listener) => listener(state));
}

function setStatus(nextStatus, reason) {
  shareStatus = nextStatus;
  notify(reason);
}

function getFailureReason(error) {
  // Browsers commonly report a cancelled display picker as NotAllowedError.
  if (error?.name === 'AbortError' || error?.name === 'NotAllowedError') return 'CANCELLED';
  if (error?.name === 'NotFoundError') return 'NO_SOURCE';
  if (error?.name === 'NotReadableError') return 'SOURCE_BUSY';
  return 'FAILED';
}

function handleScreenTrackEnded() {
  void stopScreenShare({ source: 'browser' });
}

function attachScreenTrackListener(track) {
  if (typeof track?.addEventListener === 'function') {
    track.addEventListener('ended', handleScreenTrackEnded);
    return;
  }
  track.onended = handleScreenTrackEnded;
}

function detachScreenTrackListener(track) {
  if (!track) return;
  if (typeof track.removeEventListener === 'function') {
    track.removeEventListener('ended', handleScreenTrackEnded);
  }
  if ('onended' in track && track.onended === handleScreenTrackEnded) track.onended = null;
}

function stopStreamTracks(stream) {
  stream?.getTracks?.().forEach((track) => {
    if (track.readyState !== 'ended') track.stop();
  });
}

function cleanupLocalShare(reason = 'stopped', shouldNotify = true) {
  if (!screenStream || stopInProgress) {
    return { stopped: false, reason: screenStream ? 'STOPPING' : 'NOT_ACTIVE' };
  }

  stopInProgress = true;
  shareStatus = SCREEN_SHARE_STATES.STOPPING;
  if (shouldNotify) notify('stopping');

  const stream = screenStream;
  const track = screenTrack;
  screenStream = null;
  screenTrack = null;
  screenSettings = null;
  detachScreenTrackListener(track);
  stopStreamTracks(stream);

  shareStatus = remotePresenter ? SCREEN_SHARE_STATES.LIVE : SCREEN_SHARE_STATES.IDLE;
  stopInProgress = false;
  if (shouldNotify) notify(reason);
  return { stopped: true };
}

async function requestDisplayMedia() {
  const conservativeOptions = { video: true, audio: true };
  try {
    // Progressive enhancement: unsupported browser hints fall back to the standard picker.
    return await navigator.mediaDevices.getDisplayMedia({
      ...conservativeOptions,
      selfBrowserSurface: 'exclude'
    });
  } catch (error) {
    if (error?.name !== 'TypeError') throw error;
    return navigator.mediaDevices.getDisplayMedia(conservativeOptions);
  }
}

export function isScreenShareSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export function getScreenShareState() {
  return getStateSnapshot();
}

export function getLiveScreenTrack() {
  const track = screenTrack || screenStream?.getVideoTracks?.()[0];
  return track?.readyState === 'live' ? track : null;
}

export function isScreenShareHealthy() {
  return Boolean(screenStream && shareStatus === SCREEN_SHARE_STATES.LIVE && getLiveScreenTrack());
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
  const requestId = ++startRequestId;
  activeStartRequestId = requestId;
  setStatus(SCREEN_SHARE_STATES.REQUESTING, 'requesting');
  try {
    const stream = await requestDisplayMedia();
    if (requestId !== startRequestId) {
      stopStreamTracks(stream);
      return { started: false, reason: 'CANCELLED' };
    }
    const track = stream.getVideoTracks?.()[0];
    if (!track) {
      stopStreamTracks(stream);
      shareStatus = SCREEN_SHARE_STATES.ERROR;
      notify('error');
      return { started: false, reason: 'NO_SOURCE' };
    }

    screenStream = stream;
    screenTrack = track;
    screenSettings = getTrackSettings(track);
    attachScreenTrackListener(track);
    shareStatus = SCREEN_SHARE_STATES.LIVE;
    notify('started');
    return { started: true, stream, track, settings: screenSettings };
  } catch (error) {
    if (requestId !== startRequestId) {
      return { started: false, reason: 'CANCELLED' };
    }
    const reason = getFailureReason(error);
    shareStatus = reason === 'CANCELLED' ? SCREEN_SHARE_STATES.IDLE : SCREEN_SHARE_STATES.ERROR;
    notify(reason === 'CANCELLED' ? 'cancelled' : 'error');
    return { started: false, reason };
  } finally {
    if (requestId === activeStartRequestId) {
      startInProgress = false;
      activeStartRequestId = 0;
    }
  }
}

export function stopScreenShare({ source = 'app' } = {}) {
  if (!screenStream) {
    return { stopped: false, reason: remotePresenter ? 'NOT_LOCAL_PRESENTER' : 'NOT_ACTIVE' };
  }
  return cleanupLocalShare(source === 'browser' ? 'browser-stopped' : 'stopped');
}

export function startMockRemoteShare({ id, name } = {}) {
  if (screenStream || remotePresenter || startInProgress) return { started: false, reason: 'ALREADY_ACTIVE' };
  remotePresenter = { id: String(id || 'participant-1'), name: String(name || 'Minh Anh') };
  shareStatus = SCREEN_SHARE_STATES.LIVE;
  notify('remote-started');
  return { started: true };
}

export function stopMockRemoteShare() {
  if (!remotePresenter) return { stopped: false, reason: 'NOT_ACTIVE' };
  remotePresenter = null;
  shareStatus = SCREEN_SHARE_STATES.IDLE;
  notify('remote-stopped');
  return { stopped: true };
}

export function cleanupScreenShare() {
  startRequestId += 1;
  const hadState = Boolean(screenStream || remotePresenter);
  const wasRequesting = startInProgress || shareStatus === SCREEN_SHARE_STATES.REQUESTING;
  cleanupLocalShare('cleanup', false);
  remotePresenter = null;
  shareStatus = SCREEN_SHARE_STATES.IDLE;
  if (hadState || wasRequesting) notify('cleanup');
}
