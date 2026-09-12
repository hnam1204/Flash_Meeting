import { ERROR_CODES } from './utils.js';

export const HOST_ACTIONS = Object.freeze({
  MUTE: 'muteParticipant',
  STOP_CAMERA: 'stopParticipantCamera',
  PROMOTE: 'promoteToCoHost',
  DEMOTE: 'demoteCoHost',
  SHARE_PERMISSION: 'setParticipantSharePermission',
  REMOVE: 'removeParticipant'
});

const ACTION_LABELS = Object.freeze({
  [HOST_ACTIONS.MUTE]: 'Tắt micro',
  [HOST_ACTIONS.STOP_CAMERA]: 'Tắt camera',
  [HOST_ACTIONS.PROMOTE]: 'Chỉ định đồng chủ trì',
  [HOST_ACTIONS.DEMOTE]: 'Gỡ quyền đồng chủ trì',
  [HOST_ACTIONS.SHARE_PERMISSION]: 'Cho phép chia sẻ màn hình',
  [HOST_ACTIONS.REMOVE]: 'Xóa khỏi cuộc họp'
});

function isHost(viewerRole) {
  return viewerRole === 'host';
}

function isCoHost(viewerRole) {
  return viewerRole === 'co-host';
}

export function getParticipantActions(viewerRole, targetParticipant) {
  if (!targetParticipant || targetParticipant.local) return [];
  if (!isHost(viewerRole) && !isCoHost(viewerRole)) return [];
  if (targetParticipant.role === 'host') return [];
  if (isCoHost(viewerRole) && targetParticipant.role !== 'member') return [];

  const actions = [HOST_ACTIONS.MUTE, HOST_ACTIONS.STOP_CAMERA];
  if (isHost(viewerRole) && targetParticipant.role === 'member') actions.push(HOST_ACTIONS.PROMOTE);
  if (isHost(viewerRole) && targetParticipant.role === 'co-host') actions.push(HOST_ACTIONS.DEMOTE);
  actions.push(HOST_ACTIONS.SHARE_PERMISSION, HOST_ACTIONS.REMOVE);
  return actions.map((id) => ({ id, label: ACTION_LABELS[id], danger: id === HOST_ACTIONS.REMOVE }));
}

export function canUseHostAction(viewerRole, targetParticipant, action) {
  return getParticipantActions(viewerRole, targetParticipant).some((item) => item.id === action);
}

export function getHostActionFailureMessage(action) {
  if (action === HOST_ACTIONS.REMOVE) return 'Không thể xóa thành viên khỏi cuộc họp.';
  if (action === HOST_ACTIONS.PROMOTE || action === HOST_ACTIONS.DEMOTE) return 'Không thể cập nhật quyền của thành viên.';
  return 'Không thể cập nhật trạng thái thành viên.';
}

export function createHostControlRequest(action, payload = {}) {
  // SECURITY: Host/Co-host actions require trusted server authorization. Client role checks only control UI visibility.
  return {
    action,
    payload,
    errorCode: ERROR_CODES.FOUNDATION_NOT_READY,
    message: 'Host actions require server-side authorization.'
  };
}
