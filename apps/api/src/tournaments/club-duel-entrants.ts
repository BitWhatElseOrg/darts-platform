import type { ClubSide, ClubStandings } from "@darts-platform/tournament-engine";

interface FinalRoundMatchLike {
  readonly status: string;
  readonly participantOneId: string | null;
  readonly participantTwoId: string | null;
}

export interface FinalRoundEntrant {
  readonly playerId: string;
  readonly qualifyingRank: number;
}

/** Besetzte Finalrunde: kein Platzhalter-Spiel (WAITING) mehr offen. */
export function isFinalRoundOccupied(finalRoundMatches: readonly FinalRoundMatchLike[]): boolean {
  return finalRoundMatches.length > 0 && !finalRoundMatches.some((match) => match.status === "WAITING");
}

/** Voraussichtliche Finalrunden-Teilnehmer je Seite: die besten `size` aktiven Spieler der Quali-Rangliste. */
export function projectedQualifiers(standings: ClubStandings, size: number): { readonly A: readonly string[]; readonly B: readonly string[] } {
  const top = (rows: ClubStandings["sideA"]) => rows.filter((row) => !row.withdrawn).slice(0, size).map((row) => row.playerId);
  return { A: top(standings.sideA), B: top(standings.sideB) };
}

/**
 * Teilnehmer einer bereits besetzten Finalrunde je Seite. Sie stehen mit der
 * Besetzung fest; ein spaeterer Rueckzug aendert sie nicht (siehe
 * `advance-club-duel.ts`). Rang = Platz in der Quali-Rangliste.
 */
export function occupiedFinalRoundEntrants(
  finalRoundMatches: readonly FinalRoundMatchLike[],
  sideOf: ReadonlyMap<string, ClubSide>,
  standings: ClubStandings,
  side: ClubSide,
): FinalRoundEntrant[] {
  const ids = new Set(
    finalRoundMatches
      .flatMap((match) => [match.participantOneId, match.participantTwoId])
      .filter((id): id is string => id !== null && sideOf.get(id) === side),
  );
  return [...ids].map((playerId) => {
    const rank = (side === "A" ? standings.sideA : standings.sideB).find((row) => row.playerId === playerId)?.position;
    if (rank === undefined) throw new Error("Qualifier rank invariant violated.");
    return { playerId, qualifyingRank: rank };
  });
}
