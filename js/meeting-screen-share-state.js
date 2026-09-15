export const SCREEN_SHARE_MEDIA_STATES = Object.freeze({
  IDLE: 'IDLE',
  ANNOUNCED: 'ANNOUNCED',
  PUBLISHING: 'PUBLISHING',
  SUBSCRIBING: 'SUBSCRIBING',
  LIVE: 'LIVE',
  RECOVERING: 'RECOVERING',
  FAILED: 'FAILED',
  STOPPING: 'STOPPING',
  ENDED: 'ENDED'
});

export function normalizeTrackSource(source) {
  const normalized = String(source ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'camera' || normalized === 'microphone' || normalized === 'screen_share' || normalized === 'screen_share_audio') {
    return normalized;
  }
  if (normalized === 'screen' || normalized === 'screenshare') return 'screen_share';
  if (normalized === 'screenshare_audio' || normalized === 'screen_audio') return 'screen_share_audio';
  if (normalized === 'mic' || normalized === 'audio') return 'microphone';
  return normalized;
}

export function getTrackKey(identity, source) {
  return `${String(identity ?? '').trim()}:${normalizeTrackSource(source)}`;
}

export function isLiveScreenShareTrack(track) {
  if (!track) return false;
  if (track.isMuted === true) return false;
  const mediaTrack = track.mediaStreamTrack || track;
  return mediaTrack.kind === 'video' && mediaTrack.readyState !== 'ended';
}

export function hasScreenShareMedia(state = {}) {
  return Boolean(state.mediaLive && isLiveScreenShareTrack(state.track));
}
