import { publicConfig } from './config.js';
import { createMediaController } from './meeting-media.js';
import { startScreenShare } from './meeting-screen-share.js';

const media = createMediaController();

document.querySelectorAll('[data-media-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.mediaAction;
    const enabled = action === 'microphone' ? media.toggleMicrophone() : media.toggleCamera();
    button.classList.toggle('is-off', !enabled);
    button.querySelector('small').textContent = enabled ? (action === 'microphone' ? 'Mute' : 'Camera') : 'Turn on';
  });
});

document.querySelector('[data-screen-share]')?.addEventListener('click', async (event) => {
  const result = await startScreenShare();
  event.currentTarget.setAttribute('aria-label', result.started ? 'Stop screen share' : 'Screen share not connected');
});

// TODO Phase 4: request a server-generated meeting-token before connecting the room.
if (publicConfig.livekitUrl) {
  import('./livekit-client.js')
    .then(({ createLiveKitRoom }) => createLiveKitRoom())
    .catch((error) => console.warn('LiveKit foundation could not load.', error));
}
