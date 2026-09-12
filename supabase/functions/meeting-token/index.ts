// FLASH MEETING Phase 1 scaffold.
// TODO Phase 4: verify membership and sign a short-lived LiveKit token server-side.
const response = {
  errorCode: 'FOUNDATION_NOT_READY',
  message: 'meeting-token is reserved for the Phase 4 Supabase implementation.'
};

Deno.serve(() => new Response(JSON.stringify(response), {
  status: 501,
  headers: { 'content-type': 'application/json' }
}));
