interface WalkoverDecisionParticipants {
  readonly participantOneId: string | null;
  readonly participantTwoId: string | null;
  readonly winnerPlayerId: string | null;
}

export function getWalkoverWithdrawnPlayerId(
  decision: WalkoverDecisionParticipants,
  withdrawnPlayerIds: ReadonlySet<string>,
): string {
  const candidates = [decision.participantOneId, decision.participantTwoId]
    .filter((playerId): playerId is string =>
      playerId !== null &&
      withdrawnPlayerIds.has(playerId),
    );
  const [withdrawnPlayerId] = candidates;
  if (
    candidates.length !== 1 ||
    withdrawnPlayerId === undefined ||
    withdrawnPlayerId === decision.winnerPlayerId
  ) {
    throw new Error("Walkover withdrawal invariant violated.");
  }
  return withdrawnPlayerId;
}
