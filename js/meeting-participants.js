export const PARTICIPANT_ROLES = Object.freeze({
  HOST: 'host',
  CO_HOST: 'co-host',
  MEMBER: 'member'
});

export const PARTICIPANT_TABS = Object.freeze({
  JOINED: 'joined',
  WAITING: 'waiting',
  HOSTS: 'hosts'
});

export function getParticipantRoleLabel(role) {
  if (role === PARTICIPANT_ROLES.HOST) return 'Chủ phòng';
  if (role === PARTICIPANT_ROLES.CO_HOST) return 'Đồng chủ trì';
  return 'Thành viên';
}

export function filterParticipants(participants, query = '') {
  const normalizedQuery = String(query).trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...participants];
  return participants.filter((participant) => String(participant.name ?? '').toLocaleLowerCase().includes(normalizedQuery));
}

export function getParticipantRoleCounts(participants) {
  return participants.reduce((counts, participant) => {
    if (participant.role === PARTICIPANT_ROLES.HOST) counts.host += 1;
    if (participant.role === PARTICIPANT_ROLES.CO_HOST) counts.coHost += 1;
    return counts;
  }, { host: 0, coHost: 0 });
}

export function createParticipantStore(initialParticipants = []) {
  const participants = new Map(initialParticipants.map((participant) => [participant.id, participant]));

  return {
    list() {
      return [...participants.values()];
    },
    upsert(participant) {
      if (!participant?.id) return;
      participants.set(participant.id, participant);
    },
    update(participantId, changes = {}) {
      const participant = participants.get(participantId);
      if (!participant) return null;
      const nextParticipant = { ...participant, ...changes };
      participants.set(participantId, nextParticipant);
      return nextParticipant;
    },
    remove(participantId) {
      participants.delete(participantId);
    }
  };
}
