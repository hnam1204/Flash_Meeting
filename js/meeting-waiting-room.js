import { getPageUrl, setStatus } from './utils.js';

const roomCode = sessionStorage.getItem('flashMeeting.roomCode');
const status = document.querySelector('[data-form-status]');

// TODO Phase 7: subscribe to Supabase Realtime join-request updates and navigate on approval.
if (roomCode && status) setStatus(status, `Waiting for approval to enter room ${roomCode}.`);

document.querySelector('a[href="index.html"]')?.addEventListener('click', () => {
  sessionStorage.removeItem('flashMeeting.roomCode');
  window.location.href = getPageUrl('index.html');
});
