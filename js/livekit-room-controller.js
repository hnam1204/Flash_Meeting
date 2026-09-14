import { RoomEvent, Track } from 'livekit-client';
import { createLiveKitRoom, connectLiveKitRoom } from './livekit-client.js';

const DEFAULT_TOPIC = 'flash-meeting-events';

function parseMetadata(participant) {
  try {
    const value = JSON.parse(participant?.metadata || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function participantSnapshot(participant, local = false) {
  const metadata = parseMetadata(participant);
  return {
    id: String(metadata.participantId || participant?.identity || '').trim(),
    userId: String(metadata.userId || '').trim(),
    sessionId: String(metadata.sessionId || '').trim(),
    livekitIdentity: String(participant?.identity || '').trim(),
    name: String(participant?.name || 'Gmail user').trim() || 'Gmail user',
    role: String(metadata.role || 'member').trim(),
    local,
    cameraEnabled: Boolean(participant?.isCameraEnabled),
    microphoneEnabled: Boolean(participant?.isMicrophoneEnabled),
    shareScreenAllowed: metadata.shareScreenAllowed !== false,
    handRaised: Boolean(metadata.handRaised),
    speaking: Boolean(participant?.isSpeaking)
  };
}

function mapConnectionState(value) {
  if (value === 'reconnecting' || value === 'signalReconnecting') return 'RECONNECTING';
  if (value === 'connected') return 'CONNECTED';
  if (value === 'connecting') return 'CONNECTING';
  return 'DISCONNECTED';
}

export function createLiveKitRoomController({
  onParticipants,
  onParticipant,
  onTrack,
  onTrackRemoved,
  onData,
  onSpeakers,
  onConnection,
  onDisconnected,
  onError
} = {}) {
  let room = null;
  let connected = false;
  let disposed = false;
  const remoteTracks = new Map();
  const audioElements = new Map();
  const handlers = [];

  function reportError(error, code = 'LIVEKIT_CONNECTION_FAILED') {
    onError?.({ code, error });
  }

  function emitParticipants() {
    if (!room) return;
    const participants = [
      participantSnapshot(room.localParticipant, true),
      ...Array.from(room.remoteParticipants.values(), (participant) => participantSnapshot(participant, false))
    ].filter((participant) => participant.id);
    onParticipants?.(participants);
  }

  function emitParticipant(participant, local = false) {
    const snapshot = participantSnapshot(participant, local);
    if (snapshot.id) onParticipant?.(snapshot);
    emitParticipants();
  }

  function bind(event, callback) {
    room.on(event, callback);
    handlers.push([event, callback]);
  }

  function handleSubscribed(track, publication, participant) {
    const key = `${participant.identity}:${publication.source}`;
    remoteTracks.set(key, { track, publication, participant });
    if (publication.source === Track.Source.Microphone || publication.source === Track.Source.ScreenShareAudio) {
      const audio = track.attach();
      audio.autoplay = true;
      audio.setAttribute('aria-label', `Âm thanh của ${participant.name || 'thành viên'}`);
      audio.dataset.remoteAudio = key;
      document.body.append(audio);
      audioElements.set(key, { track, audio });
      audio.play?.().catch(() => {
        onError?.({ code: 'AUDIO_PLAYBACK_BLOCKED', error: new Error('AUDIO_PLAYBACK_BLOCKED') });
      });
    }
    onTrack?.({ type: 'subscribed', track, publication, participant, source: publication.source });
    emitParticipant(participant);
  }

  function handleUnsubscribed(track, publication, participant) {
    const key = `${participant.identity}:${publication.source}`;
    track.detach?.();
    const audioEntry = audioElements.get(key);
    audioEntry?.audio?.remove();
    audioElements.delete(key);
    remoteTracks.delete(key);
    onTrackRemoved?.({ track, publication, participant, source: publication.source });
    emitParticipant(participant);
  }

  function handleData(payload, participant, _kind, topic) {
    try {
      const decoded = new TextDecoder().decode(payload);
      const data = JSON.parse(decoded);
      onData?.(data, participant, topic);
    } catch {
      reportError(new Error('INVALID_DATA_PAYLOAD'), 'INVALID_DATA_PAYLOAD');
    }
  }

  async function connect({ token, livekitUrl } = {}) {
    if (disposed) return { success: false, code: 'DISPOSED' };
    if (!token || !livekitUrl) return { success: false, code: 'LIVEKIT_CONNECTION_NOT_READY' };
    if (room) await disconnect({ stopTracks: false });
    room = createLiveKitRoom();
    if (!room) return { success: false, code: 'LIVEKIT_NOT_CONFIGURED' };

    bind(RoomEvent.Connected, () => {
      connected = true;
      onConnection?.('CONNECTED');
      emitParticipants();
    });
    bind(RoomEvent.Reconnecting, () => onConnection?.('RECONNECTING'));
    bind(RoomEvent.SignalReconnecting, () => onConnection?.('RECONNECTING'));
    bind(RoomEvent.Reconnected, () => {
      onConnection?.('CONNECTED');
      emitParticipants();
    });
    bind(RoomEvent.ConnectionStateChanged, (state) => onConnection?.(mapConnectionState(state)));
    bind(RoomEvent.Disconnected, (reason) => {
      connected = false;
      onConnection?.('DISCONNECTED');
      onDisconnected?.(reason);
    });
    bind(RoomEvent.ParticipantConnected, (participant) => emitParticipant(participant));
    bind(RoomEvent.ParticipantDisconnected, (participant, reason) => {
      for (const [key, entry] of remoteTracks) {
        if (entry.participant.identity !== participant.identity) continue;
        entry.track.detach?.();
        audioElements.get(key)?.audio?.remove();
        audioElements.delete(key);
        remoteTracks.delete(key);
      }
      onParticipant?.({ id: participantSnapshot(participant).id, livekitIdentity: participant.identity, disconnected: true, reason });
      emitParticipants();
    });
    bind(RoomEvent.TrackSubscribed, handleSubscribed);
    bind(RoomEvent.TrackUnsubscribed, handleUnsubscribed);
    bind(RoomEvent.TrackPublished, (publication, participant) => emitParticipant(participant));
    bind(RoomEvent.TrackUnpublished, (publication, participant) => emitParticipant(participant));
    bind(RoomEvent.TrackMuted, (_publication, participant) => emitParticipant(participant));
    bind(RoomEvent.TrackUnmuted, (_publication, participant) => emitParticipant(participant));
    bind(RoomEvent.ParticipantMetadataChanged, (_metadata, participant) => emitParticipant(participant, participant === room.localParticipant));
    bind(RoomEvent.ParticipantAttributesChanged, (_attributes, participant) => emitParticipant(participant, participant === room.localParticipant));
    bind(RoomEvent.ParticipantNameChanged, (_name, participant) => emitParticipant(participant, participant === room.localParticipant));
    bind(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      onSpeakers?.(speakers.map((participant) => participant.identity));
      emitParticipants();
    });
    bind(RoomEvent.DataReceived, handleData);

    onConnection?.('CONNECTING');
    try {
      await connectLiveKitRoom(room, token, livekitUrl);
      emitParticipants();
      return { success: true, room };
    } catch (error) {
      reportError(error);
      await disconnect({ stopTracks: false });
      return { success: false, code: 'LIVEKIT_CONNECTION_FAILED', error };
    }
  }

  async function publishTrack(kind, mediaTrack) {
    if (!room?.localParticipant || !mediaTrack) return { success: false, code: 'LIVEKIT_NOT_CONNECTED' };
    const source = kind === 'camera' ? Track.Source.Camera : kind === 'microphone' ? Track.Source.Microphone : Track.Source.ScreenShare;
    const existing = room.localParticipant.getTrackPublication(source);
    if (existing?.track?.mediaStreamTrack === mediaTrack) return { success: true, publication: existing };
    if (existing?.track) await room.localParticipant.unpublishTrack(existing.track, false);
    try {
      const publication = await room.localParticipant.publishTrack(mediaTrack, { source });
      emitParticipants();
      return { success: true, publication };
    } catch (error) {
      reportError(error, 'LIVEKIT_PUBLISH_FAILED');
      return { success: false, code: 'LIVEKIT_PUBLISH_FAILED', error };
    }
  }

  async function setTrackEnabled(kind, enabled) {
    if (!room?.localParticipant) return { success: false, code: 'LIVEKIT_NOT_CONNECTED' };
    const source = kind === 'camera' ? Track.Source.Camera : Track.Source.Microphone;
    const publication = room.localParticipant.getTrackPublication(source);
    if (!publication) return { success: enabled ? 'NOT_PUBLISHED' : true };
    try {
      if (enabled) await publication.unmute();
      else await publication.mute();
      emitParticipants();
      return { success: true };
    } catch (error) {
      reportError(error, 'LIVEKIT_TRACK_UPDATE_FAILED');
      return { success: false, code: 'LIVEKIT_TRACK_UPDATE_FAILED', error };
    }
  }

  async function unpublish(kind) {
    if (!room?.localParticipant) return { success: true };
    const source = kind === 'camera' ? Track.Source.Camera : kind === 'microphone' ? Track.Source.Microphone : Track.Source.ScreenShare;
    const publication = room.localParticipant.getTrackPublication(source);
    if (publication?.track) await room.localParticipant.unpublishTrack(publication.track, false);
    emitParticipants();
    return { success: true };
  }

  async function publishCamera(mediaTrack) { return publishTrack('camera', mediaTrack); }
  async function publishMicrophone(mediaTrack) { return publishTrack('microphone', mediaTrack); }
  async function publishScreenShare(mediaTrack) { return publishTrack('screen', mediaTrack); }
  async function setCameraEnabled(enabled) { return setTrackEnabled('camera', enabled); }
  async function setMicrophoneEnabled(enabled) { return setTrackEnabled('microphone', enabled); }
  async function stopScreenShare() { return unpublish('screen'); }

  async function publishData(value, topic = DEFAULT_TOPIC) {
    if (!room?.localParticipant) return { success: false, code: 'LIVEKIT_NOT_CONNECTED' };
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      await room.localParticipant.publishData(bytes, { reliable: true, topic });
      return { success: true };
    } catch (error) {
      reportError(error, 'LIVEKIT_DATA_FAILED');
      return { success: false, code: 'LIVEKIT_DATA_FAILED', error };
    }
  }

  function attachRemoteTrack(livekitIdentity, source, element) {
    if (!element) return false;
    const entry = remoteTracks.get(`${livekitIdentity}:${source}`);
    if (!entry?.track) return false;
    entry.track.attach(element);
    element.autoplay = true;
    element.playsInline = true;
    element.play?.().catch(() => {});
    return true;
  }

  function detachAllTracks() {
    for (const [key, { track }] of remoteTracks) {
      if (key.endsWith(':camera') || key.endsWith(':screen_share')) track.detach?.();
    }
  }

  async function startAudio() {
    try {
      await room?.startAudio?.();
      return { success: true };
    } catch (error) {
      reportError(error, 'AUDIO_PLAYBACK_BLOCKED');
      return { success: false, code: 'AUDIO_PLAYBACK_BLOCKED' };
    }
  }

  async function disconnect({ stopTracks = false } = {}) {
    if (!room) return;
    connected = false;
    for (const { track } of remoteTracks.values()) track.detach?.();
    for (const { audio } of audioElements.values()) audio.remove();
    remoteTracks.clear();
    audioElements.clear();
    for (const [event, callback] of handlers.splice(0)) room.off?.(event, callback);
    try { await room.disconnect(stopTracks); } catch { /* Connection cleanup is best effort. */ }
    room = null;
  }

  function close() {
    disposed = true;
    void disconnect({ stopTracks: false });
  }

  return Object.freeze({
    connect,
    close,
    disconnect,
    publishCamera,
    publishMicrophone,
    publishScreenShare,
    setCameraEnabled,
    setMicrophoneEnabled,
    stopScreenShare,
    publishData,
    attachRemoteTrack,
    detachAllTracks,
    startAudio,
    get room() { return room; },
    get connected() { return connected; }
  });
}
