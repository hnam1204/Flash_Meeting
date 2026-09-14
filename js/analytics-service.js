import { configState } from './config.js';

export const ANALYTICS_ERROR_CODES = Object.freeze({
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  BACKEND_NOT_READY: 'BACKEND_NOT_READY',
  NETWORK_ERROR: 'NETWORK_ERROR',
  ANALYTICS_LOAD_FAILED: 'ANALYTICS_LOAD_FAILED'
});

const VISIT_SESSION_KEY = 'flashMeeting.analytics.visitSession';
const REALTIME_CHANNEL_NAME = 'flash-meeting-analytics-summary';

let supabasePromise;
let visitInFlight;
let realtimeChannel = null;
let realtimeSetupPromise = null;
const realtimeSubscribers = new Set();

function createError(code, message = '') {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

async function getSupabase() {
  if (!configState.hasSupabase) return null;
  if (!supabasePromise) {
    supabasePromise = import('./supabase-client.js')
      .then((module) => module.supabase)
      .catch(() => null);
  }
  return supabasePromise;
}

function getVisitSessionId() {
  try {
    const stored = String(sessionStorage.getItem(VISIT_SESSION_KEY) || '').trim();
    if (stored.length >= 16 && stored.length <= 128) return stored;
  } catch {
    // Fall back to an in-memory id when sessionStorage is restricted.
  }

  const generated = globalThis.crypto?.randomUUID?.()
    || `visit-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  try { sessionStorage.setItem(VISIT_SESSION_KEY, generated); } catch { /* Optional browser storage. */ }
  return generated;
}

function isBackendMissing(error) {
  return ['PGRST202', 'PGRST205', '42P01', '42883'].includes(String(error?.code || ''));
}

function isNetworkError(error) {
  const status = Number(error?.status);
  return status === 0 || status === 408 || status >= 500
    || ['AbortError', 'FetchError', 'NetworkError', 'TypeError'].includes(error?.name);
}

function numberValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function normalizeSnapshot(rawSnapshot) {
  const raw = rawSnapshot && typeof rawSnapshot === 'object' ? rawSnapshot : {};
  const rawSummary = raw.summary && typeof raw.summary === 'object' ? raw.summary : {};
  const activity = Array.isArray(raw.activity24h) ? raw.activity24h : [];

  return {
    summary: {
      totalVisits: numberValue(rawSummary.totalVisits),
      totalUsers: numberValue(rawSummary.totalUsers),
      totalMeetings: numberValue(rawSummary.totalMeetings),
      activeMeetings: numberValue(rawSummary.activeMeetings),
      updatedAt: rawSummary.updatedAt || null
    },
    activity24h: activity.map((bucket) => ({
      time: bucket?.time || bucket?.bucket_start || null,
      visits: numberValue(bucket?.visits),
      meetingsStarted: numberValue(bucket?.meetingsStarted ?? bucket?.meetings_started)
    }))
  };
}

export async function recordVisit() {
  if (visitInFlight) return visitInFlight;

  visitInFlight = (async () => {
    const supabase = await getSupabase();
    if (!supabase) return { success: false, code: ANALYTICS_ERROR_CODES.CONFIGURATION_ERROR };

    const { data, error } = await supabase.rpc('flash_meeting_record_visit', {
      p_session_id: getVisitSessionId()
    });
    if (error) {
      return {
        success: false,
        code: isNetworkError(error)
          ? ANALYTICS_ERROR_CODES.NETWORK_ERROR
          : isBackendMissing(error)
            ? ANALYTICS_ERROR_CODES.BACKEND_NOT_READY
            : ANALYTICS_ERROR_CODES.ANALYTICS_LOAD_FAILED,
        error
      };
    }
    return { success: true, data };
  })().catch((error) => ({
    success: false,
    code: ANALYTICS_ERROR_CODES.NETWORK_ERROR,
    error
  })).finally(() => {
    visitInFlight = null;
  });

  return visitInFlight;
}

export async function getGlobalAnalytics() {
  const supabase = await getSupabase();
  if (!supabase) throw createError(ANALYTICS_ERROR_CODES.CONFIGURATION_ERROR);

  const { data, error } = await supabase.rpc('flash_meeting_get_global_analytics');
  if (error) {
    throw Object.assign(createError(
      isNetworkError(error)
        ? ANALYTICS_ERROR_CODES.NETWORK_ERROR
        : isBackendMissing(error)
          ? ANALYTICS_ERROR_CODES.BACKEND_NOT_READY
          : error.code === '42501'
            ? ANALYTICS_ERROR_CODES.AUTH_REQUIRED
            : ANALYTICS_ERROR_CODES.ANALYTICS_LOAD_FAILED,
      error.message
    ), { cause: error });
  }
  return normalizeSnapshot(data);
}

function notifyRealtimeStatus(status, error = null) {
  realtimeSubscribers.forEach((subscriber) => subscriber.onStatus?.(status, error));
}

async function ensureRealtimeChannel() {
  if (realtimeChannel || realtimeSetupPromise || !realtimeSubscribers.size) return;
  realtimeSetupPromise = (async () => {
    const supabase = await getSupabase();
    if (!supabase || !realtimeSubscribers.size) {
      notifyRealtimeStatus('UNAVAILABLE');
      return;
    }

    const channel = supabase
      .channel(REALTIME_CHANNEL_NAME)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'analytics_summary', filter: 'scope=eq.global' },
        (payload) => realtimeSubscribers.forEach((subscriber) => subscriber.onChange?.(payload))
      );

    realtimeChannel = channel;
    channel.subscribe((status, error) => {
      notifyRealtimeStatus(status, error || null);
    });
  })().catch((error) => {
    notifyRealtimeStatus('CHANNEL_ERROR', error);
  }).finally(() => {
    realtimeSetupPromise = null;
  });
  await realtimeSetupPromise;
}

export function subscribeGlobalAnalytics({ onChange, onStatus } = {}) {
  if (typeof onChange !== 'function' && typeof onStatus !== 'function') return () => {};
  const subscriber = { onChange, onStatus };
  realtimeSubscribers.add(subscriber);
  void ensureRealtimeChannel();

  return () => {
    realtimeSubscribers.delete(subscriber);
    if (realtimeSubscribers.size || !realtimeChannel) return;
    const channel = realtimeChannel;
    realtimeChannel = null;
    // The singleton channel is removed when the last panel leaves the page.
    void getSupabase().then((client) => client?.removeChannel(channel));
  };
}

export function destroyAnalyticsRealtime() {
  realtimeSubscribers.clear();
  const channel = realtimeChannel;
  realtimeChannel = null;
  if (channel) void getSupabase().then((client) => client?.removeChannel(channel));
}
