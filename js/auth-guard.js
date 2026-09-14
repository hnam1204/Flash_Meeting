import { AUTH_ERROR_CODES, authService } from './auth-service.js';
import {
  AUTH_SESSION_CODES,
  configureAuthSession,
  registerAuthExpiryCleanup
} from './auth-session.js';

export const AUTH_GUARD_STATES = Object.freeze({
  AUTH_INITIALIZING: 'AUTH_INITIALIZING',
  AUTHENTICATED: 'AUTHENTICATED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  AUTH_ERROR: 'AUTH_ERROR'
});

let revalidationBound = false;
let revalidationInFlight = null;

function getCurrentRoute() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function setGuardState(state) {
  document.body.dataset.authGuardState = state;
}

export function redirectToLogin({ nextRoute = getCurrentRoute(), reason = '' } = {}) {
  const loginUrl = authService.getLoginUrl(nextRoute, reason);
  window.location.replace(loginUrl);
}

function configureGuard() {
  configureAuthSession({
    onExpired: ({ reason }) => {
      setGuardState(reason === 'session_expired'
        ? AUTH_GUARD_STATES.SESSION_EXPIRED
        : AUTH_GUARD_STATES.UNAUTHENTICATED);
      redirectToLogin({ reason: reason === 'session_expired' ? 'session_expired' : '' });
    }
  });
}

export async function revalidateSessionSilently() {
  if (document.body.dataset.authGuardState !== AUTH_GUARD_STATES.AUTHENTICATED) return null;
  if (revalidationInFlight) return revalidationInFlight;

  revalidationInFlight = (async () => {
    let result;
    try {
      result = await authService.bootstrapSession();
    } catch {
      return { success: false, code: AUTH_ERROR_CODES.NETWORK_ERROR, session: null, user: null };
    }
    if (result.success && result.session) {
      setGuardState(AUTH_GUARD_STATES.AUTHENTICATED);
      return result;
    }

    // A transient auth/network failure must not blank or eject an active meeting.
    const transientFailure = [
      AUTH_ERROR_CODES.NETWORK_ERROR,
      AUTH_ERROR_CODES.SESSION_ERROR,
      AUTH_ERROR_CODES.CONFIGURATION_ERROR
    ].includes(result.code);
    if (transientFailure) return result;

    setGuardState(result.code === AUTH_ERROR_CODES.SESSION_EXPIRED
      ? AUTH_GUARD_STATES.SESSION_EXPIRED
      : AUTH_GUARD_STATES.UNAUTHENTICATED);
    redirectToLogin({
      reason: result.code === AUTH_ERROR_CODES.SESSION_EXPIRED ? 'session_expired' : ''
    });
    return result;
  })();

  try {
    return await revalidationInFlight;
  } finally {
    revalidationInFlight = null;
  }
}

function revalidateProtectedPage() {
  void revalidateSessionSilently();
}

function bindRevalidationEvents() {
  if (revalidationBound) return;
  revalidationBound = true;
  window.addEventListener('focus', revalidateProtectedPage);
  window.addEventListener('pageshow', revalidateProtectedPage);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revalidateProtectedPage();
  });
}

export async function protectPage() {
  setGuardState(AUTH_GUARD_STATES.AUTH_INITIALIZING);
  configureGuard();

  const result = await authService.bootstrapSession();
  if (result.success && result.session) {
    setGuardState(AUTH_GUARD_STATES.AUTHENTICATED);
    bindRevalidationEvents();
    return result;
  }

  if (document.body.dataset.authGuardState !== AUTH_GUARD_STATES.SESSION_EXPIRED) {
    setGuardState(result.code === AUTH_ERROR_CODES.SESSION_EXPIRED
      || result.code === AUTH_SESSION_CODES.EXPIRED
      ? AUTH_GUARD_STATES.SESSION_EXPIRED
      : result.success ? AUTH_GUARD_STATES.UNAUTHENTICATED : AUTH_GUARD_STATES.AUTH_ERROR);
  }

  redirectToLogin({
    reason: result.code === AUTH_ERROR_CODES.SESSION_EXPIRED
      || result.code === AUTH_SESSION_CODES.EXPIRED
      ? 'session_expired'
      : ''
  });
  return result;
}

export { registerAuthExpiryCleanup };
