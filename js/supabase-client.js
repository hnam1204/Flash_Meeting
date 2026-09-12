import { createClient } from '@supabase/supabase-js';
import { publicConfig } from './config.js';

export const supabase = publicConfig.supabaseUrl && publicConfig.supabasePublishableKey
  ? createClient(publicConfig.supabaseUrl, publicConfig.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export function getSupabaseClient() {
  return supabase;
}
