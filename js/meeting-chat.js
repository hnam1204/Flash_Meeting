export function appendChatMessage(listElement, message) {
  if (!listElement || !message) return;

  const item = document.createElement('li');
  item.className = 'chat-message';
  item.textContent = `${message.author}: ${message.content}`;
  listElement.append(item);
}

// TODO Phase 8: persist text messages through Supabase and subscribe via Realtime.
