import { getPageUrl, readStoredRoomCode, setStatus } from './utils.js';

const form = document.querySelector('[data-prejoin-form]');
const status = document.querySelector('[data-form-status]');
const roomContext = document.querySelector('[data-room-context]');

const roomCode = readStoredRoomCode();
if (roomCode && roomContext) roomContext.textContent = `Room ${roomCode}`;

document.querySelectorAll('[data-device]').forEach((button) => {
  button.addEventListener('click', () => {
    const isPressed = button.getAttribute('aria-pressed') === 'true';
    button.setAttribute('aria-pressed', String(!isPressed));
    button.textContent = isPressed ? 'Off' : 'On';
  });
});

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  sessionStorage.setItem('flashMeeting.displayName', form.elements.displayName.value.trim());
  // TODO Phase 3: request local media devices and show a real preview before joining.
  setStatus(status, 'Local prejoin settings saved. Moving to the waiting room…', 'success');
  window.setTimeout(() => { window.location.href = getPageUrl('waiting-room.html'); }, 450);
});
