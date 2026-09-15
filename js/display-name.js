export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 50;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const RESERVED_DISPLAY_NAMES = new Set([
  'anonymous',
  'guest',
  'gmail user',
  'khách tham gia',
  'member',
  'một thành viên',
  'participant',
  'unknown',
  'user'
]);

export function normalizeMeetingDisplayName(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ');
}

function getCharacterCount(value) {
  return Array.from(value).length;
}

export function validateMeetingDisplayName(value) {
  const rawValue = String(value ?? '');
  const normalizedValue = normalizeMeetingDisplayName(rawValue);

  if (CONTROL_CHARACTER_PATTERN.test(rawValue)) {
    return { success: false, valid: false, value: normalizedValue, code: 'CONTROL_CHARACTERS' };
  }
  if (!normalizedValue) {
    return { success: false, valid: false, value: '', code: 'EMPTY' };
  }
  const characterCount = getCharacterCount(normalizedValue);
  if (characterCount < DISPLAY_NAME_MIN_LENGTH || characterCount > DISPLAY_NAME_MAX_LENGTH) {
    return { success: false, valid: false, value: normalizedValue, code: 'LENGTH' };
  }
  if (RESERVED_DISPLAY_NAMES.has(normalizedValue.toLocaleLowerCase())) {
    return { success: false, valid: false, value: normalizedValue, code: 'RESERVED' };
  }

  return { success: true, valid: true, value: normalizedValue, code: null };
}

export function isValidMeetingDisplayName(value) {
  return validateMeetingDisplayName(value).valid;
}

export function getGmailLocalPart(email) {
  const localPart = String(email ?? '').trim().split('@')[0];
  const validation = validateMeetingDisplayName(localPart);
  return validation.valid ? validation.value : '';
}

export function resolveDefaultDisplayName({ profile = null, googleUser = null, email = '' } = {}) {
  const metadata = googleUser?.user_metadata || {};
  const candidates = [
    profile?.display_name,
    metadata.full_name,
    metadata.name,
    googleUser?.full_name,
    googleUser?.name,
    googleUser?.displayName,
    getGmailLocalPart(email || googleUser?.email)
  ];

  for (const candidate of candidates) {
    const validation = validateMeetingDisplayName(candidate);
    if (validation.valid) return validation.value;
  }
  return '';
}
