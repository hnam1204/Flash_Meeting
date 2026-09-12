const SECURITY_MESSAGES = Object.freeze({
  PERMISSION_DENIED: 'You do not have permission to perform that action.',
  RATE_LIMITED: 'You are moving too quickly. Please try again shortly.',
  ACCOUNT_TEMP_BLOCKED: 'This account is temporarily limited.',
  REMOVED_FROM_MEETING: 'You were removed from the meeting.'
});

export function getSecurityMessage(code) {
  return SECURITY_MESSAGES[code] ?? 'The server could not approve that request.';
}
