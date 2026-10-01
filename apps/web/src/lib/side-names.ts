import type { MatchStateResponse } from "@darts-platform/schemas";

type Person = Pick<MatchStateResponse["participants"][number]["players"][number], "displayName" | "clubLabel">;

/**
 * Strukturell statt `MatchStateResponse["participants"][number]`: jede Seite
 * des Matchzustands passt, Tests kommen ohne vollstaendige Fixtures aus.
 */
interface Side {
  readonly players: readonly Person[];
}

/** Eine Seite kann zwei Personen tragen; ihr Name ist beider Name. */
export function sideNames(participant: Side): string {
  return participant.players.map((person) => person.displayName).join(" und ");
}

/** Im Vereinsduell mit Vereinskuerzel: «Anna Muster (VFC)». */
export function sideNamesWithClub(participant: Side): string {
  return participant.players
    .map((person) => (person.clubLabel === null ? person.displayName : `${person.displayName} (${person.clubLabel})`))
    .join(" und ");
}
