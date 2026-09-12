import { Room, VideoPresets } from 'livekit-client';
import { publicConfig } from './config.js';

export function createLiveKitRoom() {
  if (!publicConfig.livekitUrl) return null;

  return new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: {
      resolution: VideoPresets.h720.resolution
    }
  });
}

export async function connectLiveKitRoom(room, token) {
  if (!room || !publicConfig.livekitUrl || !token) {
    throw new Error('LIVEKIT_CONNECTION_NOT_READY');
  }

  return room.connect(publicConfig.livekitUrl, token);
}
