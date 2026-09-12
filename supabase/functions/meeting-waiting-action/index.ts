// FLASH MEETING Phase 1 scaffold.
// TODO Phase 7: resolve host/co-host role from the database before approve/reject.
const response = {
  errorCode: 'FOUNDATION_NOT_READY',
  message: 'meeting-waiting-action is reserved for the Phase 7 Supabase implementation.'
};

Deno.serve(() => new Response(JSON.stringify(response), {
  status: 501,
  headers: { 'content-type': 'application/json' }
}));
