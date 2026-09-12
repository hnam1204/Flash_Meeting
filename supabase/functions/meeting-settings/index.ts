// FLASH MEETING Phase 1 scaffold.
// TODO Phase 2/9: allow only the resolved host to update meeting settings.
const response = {
  errorCode: 'FOUNDATION_NOT_READY',
  message: 'meeting-settings is reserved for the Phase 2 Supabase implementation.'
};

Deno.serve(() => new Response(JSON.stringify(response), {
  status: 501,
  headers: { 'content-type': 'application/json' }
}));
