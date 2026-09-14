export const MEDIA_PREFERENCES_STORAGE_KEY = 'flashMeeting.media.preferences';

const DEFAULT_MEDIA_PREFERENCES = Object.freeze({
  cameraEnabled: true,
  micEnabled: true,
  cameraDeviceId: '',
  micDeviceId: ''
});

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizePreferences(value = {}) {
  return {
    cameraEnabled: normalizeBoolean(value.cameraEnabled, DEFAULT_MEDIA_PREFERENCES.cameraEnabled),
    micEnabled: normalizeBoolean(value.micEnabled, DEFAULT_MEDIA_PREFERENCES.micEnabled),
    cameraDeviceId: String(value.cameraDeviceId || '').trim(),
    micDeviceId: String(value.micDeviceId || '').trim()
  };
}

export function getMediaPreferences() {
  try {
    const raw = window.localStorage.getItem(MEDIA_PREFERENCES_STORAGE_KEY);
    return normalizePreferences(raw ? JSON.parse(raw) : DEFAULT_MEDIA_PREFERENCES);
  } catch {
    return { ...DEFAULT_MEDIA_PREFERENCES };
  }
}

export function saveMediaPreferences(value = {}) {
  const preferences = normalizePreferences(value);
  try {
    window.localStorage.setItem(MEDIA_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Media preferences are optional when browser storage is unavailable.
  }
  return preferences;
}

export function createMediaController(initialPreferences = getMediaPreferences()) {
  const preferences = normalizePreferences(initialPreferences);
  let microphoneEnabled = preferences.micEnabled;
  let cameraEnabled = preferences.cameraEnabled;
  let localStream = null;
  let cameraDeviceId = preferences.cameraDeviceId;
  let micDeviceId = preferences.micDeviceId;

  function setTrackEnabled(kind, enabled) {
    const tracks = kind === 'camera'
      ? localStream?.getVideoTracks?.() || []
      : localStream?.getAudioTracks?.() || [];
    tracks.forEach((track) => { track.enabled = enabled; });
  }

  function setEnabled(kind, enabled) {
    const nextEnabled = Boolean(enabled);
    if (kind === 'camera') cameraEnabled = nextEnabled;
    if (kind === 'microphone') microphoneEnabled = nextEnabled;
    setTrackEnabled(kind, nextEnabled);
    return nextEnabled;
  }

  return {
    getState() {
      return {
        microphoneEnabled,
        cameraEnabled,
        cameraDeviceId,
        micDeviceId,
        stream: localStream
      };
    },
    getStream() {
      return localStream;
    },
    setStream(stream) {
      localStream = stream ?? null;
      setTrackEnabled('camera', cameraEnabled);
      setTrackEnabled('microphone', microphoneEnabled);
    },
    setDeviceIds({ cameraDeviceId: nextCameraId, micDeviceId: nextMicId } = {}) {
      if (nextCameraId !== undefined) cameraDeviceId = String(nextCameraId || '').trim();
      if (nextMicId !== undefined) micDeviceId = String(nextMicId || '').trim();
    },
    setCameraEnabled(enabled) {
      return setEnabled('camera', enabled);
    },
    setMicrophoneEnabled(enabled) {
      return setEnabled('microphone', enabled);
    },
    toggleMicrophone() {
      return setEnabled('microphone', !microphoneEnabled);
    },
    toggleCamera() {
      return setEnabled('camera', !cameraEnabled);
    },
    stop() {
      localStream?.getTracks?.().forEach((track) => track.stop());
      localStream = null;
    }
  };
}
