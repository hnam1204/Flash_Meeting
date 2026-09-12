export async function startScreenShare() {
  // TODO Phase 6: publish a LiveKit screen track after server authorization.
  return { started: false, reason: 'SCREEN_SHARE_NOT_CONNECTED' };
}

export async function stopScreenShare() {
  return { stopped: true };
}
