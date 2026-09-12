import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

function normalizeBasePath(value) {
  if (!value || value === '/') return '/';
  return `/${value.replace(/^\/+|\/+$/g, '')}/`;
}

export default defineConfig({
  base: normalizeBasePath(process.env.VITE_BASE_PATH),
  // Support the existing local NEXT_PUBLIC_* naming without exposing server-only env names.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  build: {
    rollupOptions: {
      input: {
        home: resolve(projectRoot, 'index.html'),
        login: resolve(projectRoot, 'login.html'),
        register: resolve(projectRoot, 'register.html'),
        createMeeting: resolve(projectRoot, 'create-meeting.html'),
        joinMeeting: resolve(projectRoot, 'join-meeting.html'),
        prejoin: resolve(projectRoot, 'prejoin.html'),
        waitingRoom: resolve(projectRoot, 'waiting-room.html'),
        meeting: resolve(projectRoot, 'meeting.html'),
        meetingEnded: resolve(projectRoot, 'meeting-ended.html'),
        notFound: resolve(projectRoot, '404.html')
      }
    }
  }
});
