import { Room, VideoPresets } from 'livekit-client';
import { publicConfig } from './config.js';

export function createLiveKitRoom() {
  return new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: {
      resolution: VideoPresets.h720.resolution
    }
  });
}

export async function connectLiveKitRoom(room, token, livekitUrl = publicConfig.livekitUrl) {
  if (!room || !livekitUrl || !token) {
    throw new Error('LIVEKIT_CONNECTION_NOT_READY');
  }

  return room.connect(livekitUrl, token);
}
