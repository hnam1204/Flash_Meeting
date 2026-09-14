export const AUTH_SESSION_STORAGE_KEY = 'flashMeeting.auth.session';
const AUTH_OAUTH_PENDING_KEY = 'flashMeeting.auth.oauth-pending';
const DEFAULT_AUTH_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const OAUTH_PENDING_MAX_AGE_MS = 10 * 60 * 1000;

const localDevelopment = typeof window !== 'undefined'
  && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const configuredMaxAge = Number(import.meta.env.VITE_AUTH_SESSION_MAX_AGE_MS);

// The override is only honored by Vite development builds on local hosts.
export const AUTH_SESSION_MAX_AGE_MS = import.meta.env.DEV
  && localDevelopment
  && Number.isFinite(configuredMaxAge)
  && configuredMaxAge > 0
  ? configuredMaxAge
  : DEFAULT_AUTH_SESSION_MAX_AGE_MS;

export const AUTH_SESSION_CODES = Object.freeze({
  VALID: 'VALID',
  MISSING: 'SESSION_METADATA_MISSING',
  MISMATCH: 'SESSION_METADATA_MISMATCH',
  EXPIRED: 'SESSION_EXPIRED',
  INVALID: 'SESSION_METADATA_INVALID'
});

let currentMetadata = null;
let expirationTimer = 0;
let expirationPromise = null;
let boundSupabaseClient = null;
let signOutLocalHandler = null;
let expirationHandler = null;
const expirationCleanupHooks = new Set();

// SECURITY:
// The 6-hour browser deadline is application-level UX enforcement.
// It is not a substitute for trusted server-side session controls.

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getJwtSessionId(accessToken) {
  const encodedPayload = String(accessToken || '').split('.')[1];
  if (!encodedPayload) return '';

  try {
    const base64Payload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = base64Payload.padEnd(Math.ceil(base64Payload.length / 4) * 4, '=');
    const payload = JSON.parse(window.atob(paddedPayload));
    return String(payload?.session_id || '').trim();
  } catch {
    return '';
  }
}

function getSessionBinding(session) {
  return String(
    session?.session_id
    || session?.user?.session_id
    || getJwtSessionId(session?.access_token)
    || session?.user?.id
    || ''
  ).trim();
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const metadata = {
    userId: String(value.userId || '').trim(),
    sessionId: String(value.sessionId || '').trim(),
    startedAt: Number(value.startedAt),
    expiresAt: Number(value.expiresAt)
  };

  if (!metadata.userId || !metadata.sessionId) return null;
  if (!Number.isFinite(metadata.startedAt) || !Number.isFinite(metadata.expiresAt)) return null;
  if (metadata.startedAt <= 0 || metadata.expiresAt <= metadata.startedAt) return null;
  if (metadata.expiresAt - metadata.startedAt > AUTH_SESSION_MAX_AGE_MS) return null;
  return metadata;
}

function readStoredMetadata() {
  const storage = getLocalStorage();
  if (!storage) return null;

  let raw = null;
  try {
    raw = storage.getItem(AUTH_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const metadata = normalizeMetadata(JSON.parse(raw));
    if (metadata) return metadata;
  } catch {
    // Malformed local metadata must never break page bootstrap.
  }

  try {
    storage.removeItem(AUTH_SESSION_STORAGE_KEY);
  } catch {
    // Storage cleanup is best effort.
  }
  return null;
}

function writeMetadata(metadata) {
  currentMetadata = metadata;
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(metadata));
  } catch {
    // The Supabase session remains the source of auth state if storage is unavailable.
  }
}

function clearExpirationTimer() {
  if (!expirationTimer) return;
  window.clearTimeout(expirationTimer);
  expirationTimer = 0;
}

function scheduleExpiration(metadata = currentMetadata) {
  clearExpirationTimer();
  if (!metadata) return;

  const remainingMs = metadata.expiresAt - Date.now();
  if (remainingMs <= 0) {
    void expireFlashMeetingSession({ reason: 'session_expired' });
    return;
  }

  expirationTimer = window.setTimeout(() => {
    expirationTimer = 0;
    void expireFlashMeetingSession({ reason: 'session_expired' });
  }, remainingMs);
}

function createMetadata(session, now = Date.now()) {
  const userId = String(session?.user?.id || '').trim();
  const sessionId = getSessionBinding(session);
  if (!userId || !sessionId) return null;

  return {
    userId,
    sessionId,
    startedAt: now,
    expiresAt: now + AUTH_SESSION_MAX_AGE_MS
  };
}

function matchesSession(metadata, session) {
  return Boolean(
    metadata
    && metadata.userId === String(session?.user?.id || '').trim()
    && metadata.sessionId === getSessionBinding(session)
  );
}

export function getAuthSessionMetadata() {
  if (!currentMetadata) currentMetadata = readStoredMetadata();
  return currentMetadata ? { ...currentMetadata } : null;
}

export function clearAuthSessionMetadata() {
  currentMetadata = null;
  clearExpirationTimer();
  try {
    getLocalStorage()?.removeItem(AUTH_SESSION_STORAGE_KEY);
  } catch {
    // Storage cleanup is best effort.
  }
}

export function resolveAuthSession(session, { allowCreate = false, forceNew = false } = {}) {
  const existing = getAuthSessionMetadata();
  const now = Date.now();

  if (forceNew || !existing) {
    if (!allowCreate) {
      return { success: false, code: existing ? AUTH_SESSION_CODES.INVALID : AUTH_SESSION_CODES.MISSING, metadata: null };
    }

    const metadata = createMetadata(session, now);
    if (!metadata) return { success: false, code: AUTH_SESSION_CODES.INVALID, metadata: null };
    writeMetadata(metadata);
    scheduleExpiration(metadata);
    return { success: true, code: AUTH_SESSION_CODES.VALID, metadata, created: true };
  }

  if (!matchesSession(existing, session)) {
    return { success: false, code: AUTH_SESSION_CODES.MISMATCH, metadata: existing };
  }

  if (existing.expiresAt <= now) {
    return { success: false, code: AUTH_SESSION_CODES.EXPIRED, metadata: existing };
  }

  currentMetadata = existing;
  scheduleExpiration(existing);
  return { success: true, code: AUTH_SESSION_CODES.VALID, metadata: existing, created: false };
}

export function markOAuthLoginPending() {
  try {
    getSessionStorage()?.setItem(AUTH_OAUTH_PENDING_KEY, String(Date.now()));
  } catch {
    // OAuth callback detection can still be used when sessionStorage is unavailable.
  }
}

export function consumeOAuthLoginPending() {
  const storage = getSessionStorage();
  if (!storage) return false;

  let rawTimestamp = '';
  try {
    rawTimestamp = storage.getItem(AUTH_OAUTH_PENDING_KEY) || '';
    storage.removeItem(AUTH_OAUTH_PENDING_KEY);
  } catch {
    return false;
  }

  const timestamp = Number(rawTimestamp);
  return Number.isFinite(timestamp) && timestamp > 0 && Date.now() - timestamp <= OAUTH_PENDING_MAX_AGE_MS;
}

export function clearOAuthLoginPending() {
  try {
    getSessionStorage()?.removeItem(AUTH_OAUTH_PENDING_KEY);
  } catch {
    // Storage cleanup is best effort.
  }
}

export function configureAuthSession({ signOutLocal, onExpired } = {}) {
  if (typeof signOutLocal === 'function') signOutLocalHandler = signOutLocal;
  if (typeof onExpired === 'function') expirationHandler = onExpired;
}

export function registerAuthExpiryCleanup(cleanup) {
  if (typeof cleanup !== 'function') return () => {};
  expirationCleanupHooks.add(cleanup);
  return () => expirationCleanupHooks.delete(cleanup);
}

export async function expireFlashMeetingSession({ reason = 'session_expired' } = {}) {
  if (expirationPromise) return expirationPromise;

  expirationPromise = (async () => {
    for (const cleanup of expirationCleanupHooks) {
      try {
        await cleanup();
      } catch {
        // A failed page cleanup must not prevent local sign-out.
      }
    }

    try {
      await signOutLocalHandler?.();
    } catch {
      // Navigation must still happen if the network is unavailable.
    }
    clearAuthSessionMetadata();

    await expirationHandler?.({ reason });
  })();

  try {
    await expirationPromise;
  } finally {
    expirationPromise = null;
  }
}

function handleStorageChange(event) {
  if (event.key !== AUTH_SESSION_STORAGE_KEY) return;

  if (event.newValue === null) {
    if (getAuthSessionMetadata()) void expireFlashMeetingSession({ reason: 'signed_out' });
    return;
  }

  let nextMetadata = null;
  try {
    nextMetadata = normalizeMetadata(JSON.parse(event.newValue));
  } catch {
    nextMetadata = null;
  }

  const previousMetadata = getAuthSessionMetadata();
  if (!nextMetadata) {
    clearAuthSessionMetadata();
    if (previousMetadata) void expireFlashMeetingSession({ reason: 'signed_out' });
    return;
  }

  if (previousMetadata && (
    previousMetadata.userId !== nextMetadata.userId
    || previousMetadata.sessionId !== nextMetadata.sessionId
  )) {
    void expireFlashMeetingSession({ reason: 'signed_out' });
    return;
  }

  currentMetadata = nextMetadata;
  scheduleExpiration(nextMetadata);
}

function handleSupabaseAuthEvent(event, session) {
  if (event === 'SIGNED_OUT') {
    const hadMetadata = Boolean(getAuthSessionMetadata());
    if (hadMetadata) {
      void expireFlashMeetingSession({ reason: 'signed_out' });
    } else {
      clearAuthSessionMetadata();
    }
    return;
  }

  if (!session || !['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) return;

  const metadata = getAuthSessionMetadata();
  if (!metadata || !matchesSession(metadata, session)) return;

  if (metadata.expiresAt <= Date.now()) {
    void expireFlashMeetingSession({ reason: 'session_expired' });
    return;
  }

  // TOKEN_REFRESHED and USER_UPDATED keep the original absolute deadline.
  scheduleExpiration(metadata);
}

export function bindSupabaseAuthEvents(supabase) {
  if (!supabase || boundSupabaseClient === supabase) return;
  boundSupabaseClient = supabase;
  supabase.auth.onAuthStateChange((event, session) => {
    window.setTimeout(() => handleSupabaseAuthEvent(event, session), 0);
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', handleStorageChange);
}
