// FLASH MEETING Phase 1 scaffold.
// TODO Phase 2: authorize meeting access, capacity, lock, and waiting-room state.
const response = {
  errorCode: 'FOUNDATION_NOT_READY',
  message: 'meeting-join is reserved for the Phase 2 Supabase implementation.'
};

Deno.serve(() => new Response(JSON.stringify(response), {
  status: 501,
  headers: { 'content-type': 'application/json' }
}));
