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
    remove(participantId) {
      participants.delete(participantId);
    }
  };
}
