import { getPageUrl } from './utils.js';

export const MOCK_SESSION_KEY = 'flashMeeting.mockSession';

export const AUTH_ERROR_CODES = Object.freeze({
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  NETWORK_ERROR: 'NETWORK_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  UNVERIFIED_EMAIL: 'UNVERIFIED_EMAIL',
  REGISTER_FAILED: 'REGISTER_FAILED'
});

const MOCK_EMAIL = 'demo@flashmeeting.app';
const MOCK_PASSWORD = 'flash1234';
const MOCK_DELAY = 520;
const VALID_NEXT_ROUTES = Object.freeze([
  'index.html',
  'create-meeting.html',
  'join-meeting.html',
  'prejoin.html',
  'waiting-room.html',
  'meeting.html',
  'meeting-ended.html'
]);

function wait(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function getStorage(remember = true) {
  return remember ? localStorage : sessionStorage;
}

function getMockScenario() {
  const scenario = new URLSearchParams(window.location.search).get('mock');
  return String(scenario ?? '').toLowerCase();
}

function createSession(provider, email, remember) {
  const session = {
    provider,
    email,
    displayName: provider === 'google' ? 'Google Guest' : 'Nguyễn Hải Nam',
    createdAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 8
  };

  getStorage(remember).setItem(MOCK_SESSION_KEY, JSON.stringify(session));
  getStorage(!remember).removeItem(MOCK_SESSION_KEY);
  return session;
}

export function getMockSession() {
  for (const storage of [localStorage, sessionStorage]) {
    const storedSession = storage.getItem(MOCK_SESSION_KEY);
    if (!storedSession) continue;

    try {
      const session = JSON.parse(storedSession);
      if (session?.expiresAt > Date.now()) return session;
    } catch {
      storage.removeItem(MOCK_SESSION_KEY);
      continue;
    }

    storage.removeItem(MOCK_SESSION_KEY);
  }

  return null;
}

export function clearMockSession() {
  localStorage.removeItem(MOCK_SESSION_KEY);
  sessionStorage.removeItem(MOCK_SESSION_KEY);
}

export async function signInWithEmail({ email, password, remember = true }) {
  await wait(MOCK_DELAY);

  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const scenario = getMockScenario();
  if (scenario === 'network' || normalizedEmail === 'network@flashmeeting.app') {
    return { success: false, code: AUTH_ERROR_CODES.NETWORK_ERROR };
  }
  if (scenario === 'rate-limited' || normalizedEmail === 'rate@flashmeeting.app') {
    return { success: false, code: AUTH_ERROR_CODES.RATE_LIMITED };
  }
  if (scenario === 'unverified' || normalizedEmail === 'unverified@flashmeeting.app') {
    return { success: false, code: AUTH_ERROR_CODES.UNVERIFIED_EMAIL };
  }
  if (normalizedEmail !== MOCK_EMAIL || password !== MOCK_PASSWORD) {
    return { success: false, code: AUTH_ERROR_CODES.INVALID_CREDENTIALS };
  }

  return { success: true, user: createSession('email', MOCK_EMAIL, remember) };
}

export async function signInWithGoogle({ remember = true } = {}) {
  await wait(MOCK_DELAY + 180);
  if (getMockScenario() === 'network') {
    return { success: false, code: AUTH_ERROR_CODES.NETWORK_ERROR };
  }

  return {
    success: true,
    user: createSession('google', 'google-user@flashmeeting.app', remember)
  };
}

export async function registerWithEmail({ displayName, email, password }) {
  await wait(MOCK_DELAY + 120);

  const scenario = getMockScenario();
  if (scenario === 'network' || scenario === 'register-network') {
    return { success: false, code: AUTH_ERROR_CODES.NETWORK_ERROR };
  }
  if (scenario === 'rate-limited' || scenario === 'register-rate-limit') {
    return { success: false, code: AUTH_ERROR_CODES.RATE_LIMITED };
  }
  if (scenario === 'register-error') {
    return { success: false, code: AUTH_ERROR_CODES.REGISTER_FAILED };
  }

  return {
    success: true,
    user: {
      displayName: String(displayName ?? '').trim(),
      email: String(email ?? '').trim().toLowerCase(),
      createdAt: Date.now()
    }
  };
}

export function getSafeNextUrl(rawNext = new URLSearchParams(window.location.search).get('next')) {
  const fallback = getPageUrl('index.html');
  if (!rawNext || rawNext.length > 2048 || rawNext.includes('\\') || rawNext.startsWith('//')) return fallback;

  let candidate;
  try {
    candidate = new URL(rawNext, new URL(getPageUrl('login.html'), window.location.href));
  } catch {
    return fallback;
  }

  if (candidate.origin !== window.location.origin || candidate.protocol !== window.location.protocol) return fallback;

  const isKnownRoute = VALID_NEXT_ROUTES.some((page) => (
    new URL(getPageUrl(page), window.location.href).pathname === candidate.pathname
  ));

  return isKnownRoute ? `${candidate.pathname}${candidate.search}${candidate.hash}` : fallback;
}

export const authService = Object.freeze({
  getSession: getMockSession,
  clearSession: clearMockSession,
  signInWithEmail,
  signInWithGoogle,
  registerWithEmail,
  getSafeNextUrl
});
