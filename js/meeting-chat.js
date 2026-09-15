import { validateMeetingDisplayName } from './display-name.js';

export function appendChatMessage(listElement, message) {
  if (!listElement || !message) return;
  const author = validateMeetingDisplayName(message.author);
  if (!author.valid) return;

  const item = document.createElement('li');
  item.className = 'chat-message';
  item.textContent = `${author.value}: ${message.content}`;
  listElement.append(item);
}

// Message persistence and Realtime subscription are owned by meeting-realtime.js.
