const rawConfig = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
  livekitUrl: import.meta.env.VITE_LIVEKIT_URL ?? '',
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''
};

export const publicConfig = Object.freeze(rawConfig);

export const configState = Object.freeze({
  hasSupabase: Boolean(rawConfig.supabaseUrl && rawConfig.supabasePublishableKey),
  hasLiveKit: Boolean(rawConfig.livekitUrl),
  hasTurnstile: Boolean(rawConfig.turnstileSiteKey)
});

export function getConfigSummary() {
  if (configState.hasSupabase && configState.hasLiveKit) {
    return 'Public configuration is ready. Server authorization is still required before realtime rooms are enabled.';
  }

  return 'Foundation mode: add public Supabase and LiveKit values to .env.local before enabling realtime rooms.';
}

for (const element of document.querySelectorAll('[data-config-status]')) {
  element.setAttribute('data-config-ready', String(configState.hasSupabase && configState.hasLiveKit));
  const statusText = element.querySelector('[data-config-status-text]');
  if (statusText) statusText.textContent = getConfigSummary();
}
