import type { SetupFormValues } from "./setup-form-values";

/**
 * Formularwerte → API-Körper eines Vereinsduells (pur). Die Zod-Prüfung macht
 * `createClubDuelTournamentSchema` beim Absenden; hier wird nur umgeformt.
 */
export function buildClubDuelCandidate(values: SetupFormValues): unknown {
  return {
    name: values.name,
    startsAt: new Date(`${values.startsAt}T18:00:00.000Z`),
    format: "CLUB_DUEL",
    startingScore: Number(values.startingScore),
    inRule: values.inRule,
    outRule: values.outRule,
    maxRounds: null,
    bestOfLegs: Number(values.bestOfLegs),
    bestOfSets: values.mode === "MATCHPLAY" ? 1 : Number(values.bestOfSets),
    boardIds: [...values.boardIds],
    sideAName: values.sideAName,
    sideBName: values.sideBName,
    qualifyingRounds: Number(values.qualifyingRounds),
    finalRoundSize: Number(values.finalRoundSize),
    thirdPlaceMatch: values.thirdPlaceMatch,
    participants: [
      ...values.sideAIds.map((playerId) => ({ playerId, side: "A" as const })),
      ...values.sideBIds.map((playerId) => ({ playerId, side: "B" as const })),
    ],
  };
}
