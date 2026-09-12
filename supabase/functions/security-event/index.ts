// FLASH MEETING Phase 1 scaffold.
// TODO Phase 10: accept server-generated audit events without trusting client risk scores.
const response = {
  errorCode: 'FOUNDATION_NOT_READY',
  message: 'security-event is reserved for the Phase 10 Supabase implementation.'
};

Deno.serve(() => new Response(JSON.stringify(response), {
  status: 501,
  headers: { 'content-type': 'application/json' }
}));
