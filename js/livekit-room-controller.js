import { RoomEvent, Track } from 'livekit-client';
import { createLiveKitRoom, connectLiveKitRoom } from './livekit-client.js';
import { validateMeetingDisplayName } from './display-name.js';
import { getTrackKey, isLiveScreenShareTrack, normalizeTrackSource } from './meeting-screen-share-state.js';

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
  const cameraPublication = participant?.getTrackPublication?.(Track.Source.Camera) || null;
  const microphonePublication = participant?.getTrackPublication?.(Track.Source.Microphone) || null;
  const screenSharePublication = participant?.getTrackPublication?.(Track.Source.ScreenShare) || null;
  return {
    id: String(metadata.participantId || participant?.identity || '').trim(),
    identity: String(participant?.identity || '').trim(),
    participantId: String(metadata.participantId || '').trim(),
    userId: String(metadata.userId || '').trim(),
    sessionId: String(metadata.sessionId || '').trim(),
    livekitIdentity: String(participant?.identity || '').trim(),
    name: validateMeetingDisplayName(participant?.name).value,
    role: String(metadata.role || 'member').trim(),
    roleFromMetadata: Boolean(metadata.role),
    isConnected: true,
    local,
    cameraPublication,
    microphonePublication,
    screenSharePublication,
    cameraTrack: cameraPublication?.track || null,
    microphoneTrack: microphonePublication?.track || null,
    screenShareTrack: screenSharePublication?.track || null,
    cameraEnabled: Boolean(cameraPublication && !cameraPublication.isMuted),
    microphoneEnabled: Boolean(microphonePublication && !microphonePublication.isMuted),
    screenShareActive: Boolean(screenSharePublication && !screenSharePublication.isMuted),
    screenSharing: Boolean(screenSharePublication && !screenSharePublication.isMuted),
    audioLevel: Number(participant?.audioLevel || 0),
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
  const elementAttachments = new Map();
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

  function emitParticipant(participant, local = false, eventType = 'updated', source = '') {
    const snapshot = participantSnapshot(participant, local);
    if (snapshot.id) onParticipant?.({ ...snapshot, eventType, source });
    emitParticipants();
  }

  function bind(event, callback) {
    room.on(event, callback);
    handlers.push([event, callback]);
  }

  function handleSubscribed(track, publication, participant) {
    const source = normalizeTrackSource(publication?.source);
    const key = getTrackKey(participant?.identity, source);
    const previous = remoteTracks.get(key);
    previous?.track?.detach?.();
    audioElements.get(key)?.audio?.remove();
    audioElements.delete(key);
    remoteTracks.set(key, { track, publication, participant, source });
    if (source === 'microphone' || source === 'screen_share_audio') {
      const audio = track.attach();
      audio.autoplay = true;
      audio.setAttribute('aria-label', participant.name ? `Âm thanh của ${participant.name}` : 'Âm thanh cuộc họp');
      audio.dataset.remoteAudio = key;
      document.body.append(audio);
      audioElements.set(key, { track, audio });
      audio.play?.().catch(() => {
        onError?.({ code: 'AUDIO_PLAYBACK_BLOCKED', error: new Error('AUDIO_PLAYBACK_BLOCKED') });
      });
    }
    onTrack?.({ type: 'subscribed', track, publication, participant, source });
    emitParticipant(participant);
  }

  function handleUnsubscribed(track, publication, participant) {
    const source = normalizeTrackSource(publication?.source);
    const key = getTrackKey(participant?.identity, source);
    track.detach?.();
    for (const [element, attachedTrack] of elementAttachments) {
      if (attachedTrack === track) elementAttachments.delete(element);
    }
    const audioEntry = audioElements.get(key);
    audioEntry?.audio?.remove();
    audioElements.delete(key);
    remoteTracks.delete(key);
    onTrackRemoved?.({ track, publication, participant, source });
  }

  function handleUnpublished(publication, participant) {
    const source = normalizeTrackSource(publication?.source);
    const key = getTrackKey(participant?.identity, source);
    const entry = remoteTracks.get(key);
    if (entry?.track) {
      entry.track.detach?.();
      for (const [element, attachedTrack] of elementAttachments) {
        if (attachedTrack === entry.track) elementAttachments.delete(element);
      }
    }
    const audioEntry = audioElements.get(key);
    audioEntry?.audio?.remove();
    audioElements.delete(key);
    remoteTracks.delete(key);
    onParticipant?.({
      ...participantSnapshot(participant, participant === room?.localParticipant),
      eventType: 'track-unpublished',
      source
    });
    emitParticipants();
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
    bind(RoomEvent.ParticipantConnected, (participant) => emitParticipant(participant, false, 'connected'));
    bind(RoomEvent.ParticipantDisconnected, (participant, reason) => {
      for (const [key, entry] of remoteTracks) {
        if (entry.participant.identity !== participant.identity) continue;
        entry.track.detach?.();
        for (const [element, attachedTrack] of elementAttachments) {
          if (attachedTrack === entry.track) elementAttachments.delete(element);
        }
        audioElements.get(key)?.audio?.remove();
        audioElements.delete(key);
        remoteTracks.delete(key);
      }
      onParticipant?.({
        id: participantSnapshot(participant).id,
        identity: participant.identity,
        livekitIdentity: participant.identity,
        disconnected: true,
        eventType: 'disconnected',
        reason
      });
      emitParticipants();
    });
    bind(RoomEvent.TrackSubscribed, handleSubscribed);
    bind(RoomEvent.TrackUnsubscribed, handleUnsubscribed);
    bind(RoomEvent.TrackPublished, (publication, participant) => emitParticipant(participant, false, 'track-published', normalizeTrackSource(publication?.source)));
    bind(RoomEvent.TrackUnpublished, handleUnpublished);
    bind(RoomEvent.TrackMuted, (publication, participant) => emitParticipant(participant, false, 'track-muted', normalizeTrackSource(publication?.source)));
    bind(RoomEvent.TrackUnmuted, (publication, participant) => emitParticipant(participant, false, 'track-unmuted', normalizeTrackSource(publication?.source)));
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

  async function resubscribeRemoteTrack(livekitIdentity, source) {
    const normalizedSource = normalizeTrackSource(source);
    const key = getTrackKey(livekitIdentity, normalizedSource);
    const storedPublication = remoteTracks.get(key)?.publication;
    const participant = room?.remoteParticipants?.get(String(livekitIdentity || '').trim());
    const trackSource = normalizedSource === 'camera'
      ? Track.Source.Camera
      : normalizedSource === 'microphone'
        ? Track.Source.Microphone
        : normalizedSource === 'screen_share'
          ? Track.Source.ScreenShare
          : Track.Source.ScreenShareAudio;
    const publication = storedPublication
      || participant?.getTrackPublication?.(trackSource)
      || null;
    if (!publication) return { success: false, code: 'TRACK_NOT_PUBLISHED' };
    try {
      if (typeof publication.setSubscribed === 'function') await publication.setSubscribed(true);
      return { success: true, publication };
    } catch (error) {
      reportError(error, 'LIVEKIT_RESUBSCRIBE_FAILED');
      return { success: false, code: 'LIVEKIT_RESUBSCRIBE_FAILED', error };
    }
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
    const key = getTrackKey(livekitIdentity, source);
    const entry = remoteTracks.get(key);
    if (!entry?.track || !isLiveScreenShareTrack(entry.track)) return false;
    const currentTrack = elementAttachments.get(element);
    if (currentTrack !== entry.track) {
      currentTrack?.detach?.(element);
      entry.track.attach(element);
      elementAttachments.set(element, entry.track);
    }
    element.autoplay = true;
    element.playsInline = true;
    element.play?.().catch(() => {});
    return true;
  }

  function detachRemoteTrack(livekitIdentity, source, element) {
    const entry = remoteTracks.get(getTrackKey(livekitIdentity, source));
    if (!entry?.track) return false;
    entry.track.detach?.(element);
    if (elementAttachments.get(element) === entry.track) elementAttachments.delete(element);
    if (element) element.srcObject = null;
    return true;
  }

  function detachAllTracks() {
    for (const [key, { track }] of remoteTracks) {
      const source = key.slice(key.lastIndexOf(':') + 1);
      if (source === 'camera' || source === 'screen_share') track.detach?.();
    }
    elementAttachments.clear();
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
    elementAttachments.clear();
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
    detachRemoteTrack,
    detachAllTracks,
    resubscribeRemoteTrack,
    getRemoteTrack: (livekitIdentity, source) => remoteTracks.get(getTrackKey(livekitIdentity, source))?.track || null,
    startAudio,
    get room() { return room; },
    get connected() { return connected; }
  });
}
