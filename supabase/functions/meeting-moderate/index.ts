// FLASH MEETING Phase 1 scaffold.
// TODO Phase 9: authorize kick, mute, co-host, and stop-share actions server-side.
const response = {
  errorCode: 'FOUNDATION_NOT_READY',
  message: 'meeting-moderate is reserved for the Phase 9 Supabase implementation.'
};

Deno.serve(() => new Response(JSON.stringify(response), {
  status: 501,
  headers: { 'content-type': 'application/json' }
}));
