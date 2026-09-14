import { configState } from './config.js';
import { getPageUrl } from './utils.js';
import {
  AUTH_SESSION_CODES,
  bindSupabaseAuthEvents,
  clearAuthSessionMetadata,
  clearOAuthLoginPending,
  configureAuthSession,
  consumeOAuthLoginPending,
  expireFlashMeetingSession,
  markOAuthLoginPending,
  resolveAuthSession
} from './auth-session.js';

export const MOCK_USER_ID = 'user-demo-001';
export const AUTH_NEXT_ROUTE_KEY = 'flashMeeting.auth.next';

export const AUTH_ERROR_CODES = Object.freeze({
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  AUTH_METHOD_NOT_ALLOWED: 'AUTH_METHOD_NOT_ALLOWED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  GOOGLE_OAUTH_ERROR: 'GOOGLE_OAUTH_ERROR',
  NON_GMAIL_ACCOUNT: 'NON_GMAIL_ACCOUNT',
  SESSION_ERROR: 'SESSION_ERROR',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_METADATA_MISSING: 'SESSION_METADATA_MISSING',
  SESSION_METADATA_MISMATCH: 'SESSION_METADATA_MISMATCH',
  PROFILE_SYNC_ERROR: 'PROFILE_SYNC_ERROR'
});

const VALID_NEXT_ROUTES = Object.freeze([
  'index.html',
  'create-meeting.html',
  'join-meeting.html',
  'prejoin.html',
  'waiting-room.html',
  'meeting.html',
  'meeting-ended.html'
]);

let supabasePromise;
let currentSession = null;
let currentProfile = null;

function getMockScenario() {
  return String(new URLSearchParams(window.location.search).get('mock') || '').toLowerCase();
}

function readStorage(key) {
  try {
    return sessionStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeStorage(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Session storage is optional in restricted browser contexts.
  }
}

function removeStorage(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Session storage is optional in restricted browser contexts.
  }
}

async function loadSupabaseClient() {
  if (!configState.hasSupabase) return null;
  if (!supabasePromise) {
    supabasePromise = import('./supabase-client.js')
      .then((module) => {
        const supabase = module.supabase;
        configureAuthSession({
          signOutLocal: async () => {
            const result = await signOutSupabase(supabase);
            clearAppSession({ preserveNextRoute: true });
            return result;
          }
        });
        bindSupabaseAuthEvents(supabase);
        return supabase;
      })
      .catch(() => null);
  }
  return supabasePromise;
}

function mapSupabaseError(error, fallbackCode = AUTH_ERROR_CODES.GOOGLE_OAUTH_ERROR) {
  const status = Number(error?.status);
  if (status === 429 || error?.code === 'over_email_send_rate_limit') return AUTH_ERROR_CODES.RATE_LIMITED;
  if (status === 0 || status === 408 || status >= 500 || ['AuthRetryableFetchError', 'NetworkError', 'TypeError', 'AbortError'].includes(error?.name)) {
    return AUTH_ERROR_CODES.NETWORK_ERROR;
  }
  return fallbackCode;
}

function normalizeDisplayName(value, fallback = 'Gmail user') {
  const displayName = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (displayName.length >= 2) return displayName.slice(0, 50);
  return fallback;
}

function getGmailLocalPart(email) {
  const localPart = String(email ?? '').trim().split('@')[0];
  return normalizeDisplayName(localPart, 'Gmail user');
}

function getGoogleDisplayName(user) {
  const metadata = user?.user_metadata || {};
  return normalizeDisplayName(
    metadata.full_name || metadata.name || getGmailLocalPart(user?.email),
    'Gmail user'
  );
}

function getSafeAvatarUrl(value) {
  const rawUrl = String(value ?? '').trim();
  if (!rawUrl) return '';

  try {
    const url = new URL(rawUrl);
    return ['https:', 'http:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function isGmailAddress(email) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  return normalizedEmail.length > '@gmail.com'.length && normalizedEmail.endsWith('@gmail.com');
}

function isGoogleIdentity(user) {
  const provider = String(user?.app_metadata?.provider || '').toLowerCase();
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return provider === 'google' || identities.some((identity) => identity?.provider === 'google');
}

function toApplicationUser(user, profile = null) {
  const metadata = user?.user_metadata || {};
  const email = String(user?.email || '').trim().toLowerCase();
  const displayName = normalizeDisplayName(
    profile?.display_name || getGoogleDisplayName(user),
    getGmailLocalPart(email)
  );
  const avatarUrl = getSafeAvatarUrl(
    profile?.avatar_url || metadata.avatar_url || metadata.picture
  );
  const provider = String(user?.app_metadata?.provider || 'google').toLowerCase();

  return {
    id: user.id,
    email,
    displayName,
    avatarUrl,
    provider
  };
}

async function signOutSupabase(supabase) {
  try {
    return await supabase.auth.signOut({ scope: 'local' });
  } catch (error) {
    return { error };
  }
}

function clearAppSession({ preserveNextRoute = false, clearAuthMetadata = true } = {}) {
  currentSession = null;
  currentProfile = null;
  if (clearAuthMetadata) clearAuthSessionMetadata();
  clearOAuthLoginPending();
  if (!preserveNextRoute) removeStorage(AUTH_NEXT_ROUTE_KEY);
  for (const key of [
    'flashMeeting.displayName',
    'flashMeeting.roomCode',
    'flashMeeting.joinedMeeting',
    'flashMeeting.createdMeeting',
    'flashMeeting.waitingRequest',
    'flashMeeting.leaveResult',
    'flashMeeting.startedAt'
  ]) removeStorage(key);
}

export async function syncCurrentGoogleProfile(user) {
  const supabase = await loadSupabaseClient();
  if (!supabase || !user?.id) {
    return { success: false, code: AUTH_ERROR_CODES.PROFILE_SYNC_ERROR, profile: null };
  }

  const metadata = user.user_metadata || {};
  const displayName = getGoogleDisplayName(user);
  const avatarUrl = getSafeAvatarUrl(metadata.avatar_url || metadata.picture);
  const { data: existingProfile, error: selectError } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  if (selectError) {
    return { success: false, code: AUTH_ERROR_CODES.PROFILE_SYNC_ERROR, profile: null };
  }

  const updates = {};
  if (displayName && existingProfile?.display_name !== displayName) updates.display_name = displayName;
  if (avatarUrl && existingProfile?.avatar_url !== avatarUrl) updates.avatar_url = avatarUrl;

  let profile = existingProfile;
  if (Object.keys(updates).length) {
    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select('display_name, avatar_url')
      .maybeSingle();

    if (!updateError && updatedProfile) profile = updatedProfile;
  }

  return {
    success: true,
    code: null,
    profile: profile || { display_name: displayName, avatar_url: avatarUrl || null }
  };
}

export async function bootstrapSession() {
  const supabase = await loadSupabaseClient();
  if (!supabase) {
    clearAppSession({ preserveNextRoute: true });
    return { success: false, code: AUTH_ERROR_CODES.CONFIGURATION_ERROR, session: null, user: null };
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    clearAppSession({ preserveNextRoute: true, clearAuthMetadata: false });
    return { success: false, code: mapSupabaseError(sessionError, AUTH_ERROR_CODES.SESSION_ERROR), session: null, user: null };
  }

  if (!sessionData.session?.user) {
    clearAppSession({ preserveNextRoute: true, clearAuthMetadata: false });
    return { success: true, code: null, session: null, user: null };
  }

  // getUser verifies the identity with Supabase before Gmail enforcement or profile sync.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    clearAppSession({ preserveNextRoute: true, clearAuthMetadata: false });
    return { success: false, code: mapSupabaseError(userError, AUTH_ERROR_CODES.SESSION_ERROR), session: null, user: null };
  }

  const user = userData.user;
  if (!isGoogleIdentity(user)) {
    await signOutSupabase(supabase);
    clearAppSession({ preserveNextRoute: true });
    return { success: false, code: AUTH_ERROR_CODES.AUTH_METHOD_NOT_ALLOWED, session: null, user: null };
  }

  // SECURITY TODO: enforce Gmail-only access in trusted backend authorization when critical.
  if (!isGmailAddress(user.email)) {
    await signOutSupabase(supabase);
    clearAppSession({ preserveNextRoute: true });
    return { success: false, code: AUTH_ERROR_CODES.NON_GMAIL_ACCOUNT, session: null, user: null };
  }

  const newOAuthLogin = consumeOAuthLoginPending();
  const appSession = resolveAuthSession(sessionData.session, {
    allowCreate: newOAuthLogin,
    forceNew: newOAuthLogin
  });
  if (!appSession.success) {
    if (appSession.code === AUTH_SESSION_CODES.EXPIRED) {
      await expireFlashMeetingSession({ reason: 'session_expired' });
      return { success: false, code: AUTH_ERROR_CODES.SESSION_EXPIRED, session: null, user: null };
    }

    await signOutSupabase(supabase);
    clearAppSession({ preserveNextRoute: true });
    return {
      success: false,
      code: appSession.code === AUTH_SESSION_CODES.MISMATCH
        ? AUTH_ERROR_CODES.SESSION_METADATA_MISMATCH
        : AUTH_ERROR_CODES.SESSION_METADATA_MISSING,
      session: null,
      user: null
    };
  }

  const profileResult = await syncCurrentGoogleProfile(user);
  currentProfile = profileResult.profile;
  currentSession = toApplicationUser(user, currentProfile);

  return {
    success: true,
    code: null,
    session: currentSession,
    user: currentSession,
    profile: currentProfile,
    profileSync: profileResult.success ? 'synced' : 'unavailable'
  };
}

export async function signInWithGoogle() {
  const supabase = await loadSupabaseClient();
  if (!supabase) return { success: false, code: AUTH_ERROR_CODES.CONFIGURATION_ERROR };
  if (['network', 'network-error', 'offline'].includes(getMockScenario())) {
    return { success: false, code: AUTH_ERROR_CODES.NETWORK_ERROR };
  }

  const redirectTo = new URL(getPageUrl('login.html'), window.location.href).toString();
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: { prompt: 'select_account' }
      }
    });

    if (error || !data?.url) {
      return { success: false, code: mapSupabaseError(error) };
    }

    markOAuthLoginPending();
    return { success: true, code: null, redirectUrl: data.url };
  } catch (error) {
    return { success: false, code: mapSupabaseError(error) };
  }
}

export async function signOut() {
  const supabase = await loadSupabaseClient();
  if (!supabase) return { success: false, code: AUTH_ERROR_CODES.CONFIGURATION_ERROR };

  const { error } = await signOutSupabase(supabase);
  if (error) return { success: false, code: mapSupabaseError(error, AUTH_ERROR_CODES.SESSION_ERROR) };

  clearSession();
  return { success: true, code: null };
}

export function getSession() {
  return currentSession;
}

export function clearSession() {
  clearAppSession();
}

export function getSafeNextUrl(rawNext) {
  const fallback = 'index.html';
  const queryNext = new URLSearchParams(window.location.search).get('next');
  const requested = rawNext ?? queryNext ?? readStorage(AUTH_NEXT_ROUTE_KEY);
  if (!requested || requested.length > 2048 || requested.includes('\\') || requested.startsWith('//')) return fallback;

  let candidate;
  try {
    candidate = new URL(requested, new URL(getPageUrl('login.html'), window.location.href));
  } catch {
    return fallback;
  }

  if (candidate.origin !== window.location.origin || candidate.protocol !== window.location.protocol) return fallback;

  const knownRoute = VALID_NEXT_ROUTES.find((page) => (
    new URL(getPageUrl(page), window.location.href).pathname === candidate.pathname
  ));
  return knownRoute ? `${knownRoute}${candidate.search}${candidate.hash}` : fallback;
}

export function rememberNextRoute(rawNext) {
  const queryNext = new URLSearchParams(window.location.search).get('next');
  const requested = rawNext ?? queryNext;
  if (requested) writeStorage(AUTH_NEXT_ROUTE_KEY, getSafeNextUrl(requested));
  else if (!readStorage(AUTH_NEXT_ROUTE_KEY)) writeStorage(AUTH_NEXT_ROUTE_KEY, 'index.html');
  return getSafeNextUrl(readStorage(AUTH_NEXT_ROUTE_KEY));
}

export function consumeNextRoute() {
  const nextRoute = getSafeNextUrl(readStorage(AUTH_NEXT_ROUTE_KEY) || undefined);
  removeStorage(AUTH_NEXT_ROUTE_KEY);
  return nextRoute;
}

export function getLoginUrl(nextRoute, reason = '') {
  const url = new URL(getPageUrl('login.html'), window.location.href);
  url.searchParams.set('next', getSafeNextUrl(nextRoute || `${window.location.pathname}${window.location.search}${window.location.hash}`));
  if (reason) url.searchParams.set('reason', reason);
  return `${url.pathname}${url.search}`;
}

export function getOAuthCallbackError() {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (
    search.has('error')
    || search.has('error_code')
    || search.has('error_description')
    || hash.has('error')
    || hash.has('error_code')
    || hash.has('error_description')
  ) {
    return AUTH_ERROR_CODES.GOOGLE_OAUTH_ERROR;
  }
  return null;
}

export function clearAuthCallbackParams() {
  const url = new URL(window.location.href);
  for (const key of ['code', 'error', 'error_code', 'error_description', 'error_reason', 'state', 'type']) {
    url.searchParams.delete(key);
  }
  url.hash = '';
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
}

export const authService = Object.freeze({
  bootstrapSession,
  getSession,
  signInWithGoogle,
  signOut,
  clearSession,
  syncCurrentGoogleProfile,
  clearOAuthLoginPending,
  getSafeNextUrl,
  rememberNextRoute,
  consumeNextRoute,
  getLoginUrl,
  getOAuthCallbackError,
  clearAuthCallbackParams
});
