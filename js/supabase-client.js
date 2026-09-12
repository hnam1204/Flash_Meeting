import { createClient } from '@supabase/supabase-js';
import { publicConfig } from './config.js';

export const SUPABASE_CONNECTION_STATES = Object.freeze({
  CONFIG_MISSING: 'CONFIG_MISSING',
  CLIENT_INITIALIZED: 'CLIENT_INITIALIZED',
  REMOTE_REACHABLE: 'REMOTE_REACHABLE',
  REMOTE_UNREACHABLE: 'REMOTE_UNREACHABLE',
  INVALID_PROJECT_CONFIG: 'INVALID_PROJECT_CONFIG',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
});

export const EXPECTED_SUPABASE_HOST = 'kriymwpoiondtgqyqxsq.supabase.co';

function getConfigurationState() {
  if (!publicConfig.supabaseUrl || !publicConfig.supabasePublishableKey) {
    return SUPABASE_CONNECTION_STATES.CONFIG_MISSING;
  }

  try {
    const url = new URL(publicConfig.supabaseUrl);
    return url.protocol === 'https:' && url.host === EXPECTED_SUPABASE_HOST
      ? SUPABASE_CONNECTION_STATES.CLIENT_INITIALIZED
      : SUPABASE_CONNECTION_STATES.INVALID_PROJECT_CONFIG;
  } catch {
    return SUPABASE_CONNECTION_STATES.INVALID_PROJECT_CONFIG;
  }
}

const configurationState = getConfigurationState();

if (configurationState === SUPABASE_CONNECTION_STATES.CONFIG_MISSING) {
  throw new Error('FLASH MEETING: Missing Supabase URL or publishable key configuration.');
}

if (configurationState === SUPABASE_CONNECTION_STATES.INVALID_PROJECT_CONFIG) {
  throw new Error('FLASH MEETING: Supabase project configuration is invalid.');
}

export const supabase = createClient(publicConfig.supabaseUrl, publicConfig.supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

export function getSupabaseClient() {
  return supabase;
}

export async function checkSupabaseConnection() {
  try {
    const { error } = await supabase.auth.getSession();
    if (error) {
      return {
        status: SUPABASE_CONNECTION_STATES.REMOTE_UNREACHABLE,
        errorCode: error.code || error.name || 'AUTH_HEALTH_CHECK_FAILED'
      };
    }

    return { status: SUPABASE_CONNECTION_STATES.REMOTE_REACHABLE };
  } catch (error) {
    return {
      status: SUPABASE_CONNECTION_STATES.UNKNOWN_ERROR,
      errorCode: error?.name || 'UNKNOWN_ERROR'
    };
  }
}
