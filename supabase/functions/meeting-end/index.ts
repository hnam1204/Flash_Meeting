// FLASH MEETING Phase 1 scaffold.
// TODO Phase 9: verify the real host role before ending a meeting for everyone.
const response = {
  errorCode: 'FOUNDATION_NOT_READY',
  message: 'meeting-end is reserved for the Phase 9 Supabase implementation.'
};

Deno.serve(() => new Response(JSON.stringify(response), {
  status: 501,
  headers: { 'content-type': 'application/json' }
}));
