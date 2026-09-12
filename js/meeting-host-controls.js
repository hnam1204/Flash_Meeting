import { ERROR_CODES } from './utils.js';

export function createHostControlRequest(action, payload = {}) {
  return {
    action,
    payload,
    errorCode: ERROR_CODES.FOUNDATION_NOT_READY,
    message: 'Host actions require server-side authorization.'
  };
}
