// FLASH MEETING Phase 1 scaffold.
// TODO Phase 2: verify JWT, validate input, and create meeting records with server authority.
const response = {
  errorCode: 'FOUNDATION_NOT_READY',
  message: 'meeting-create is reserved for the Phase 2 Supabase implementation.'
};

Deno.serve(() => new Response(JSON.stringify(response), {
  status: 501,
  headers: { 'content-type': 'application/json' }
}));
