import type { MatchLiveTarget } from "@darts-platform/schemas";

/**
 * Die drei Darstellungsbausteine der Vollbildfläche (Kopfzeile, Statuszeile,
 * Spielerpanels) nehmen bewusst nur diese schmalen Formen statt des ganzen
 * `MatchStateResponse` entgegen — ein Matchzustand erfüllt sie strukturell
 * und wird unverändert übergeben.
 */
export interface RoundVisit {
  readonly legNumber: number;
  readonly playerId: string;
  readonly reverted: boolean;
}

export interface AverageVisit extends RoundVisit {
  readonly appliedPoints: number;
  readonly dartsThrown: number;
}

/**
 * Eine Runde ist voll, sobald beide Seiten im laufenden Leg gleich oft
 * geworfen haben; die angefangene Runde zählt als laufende Runde. Ohne
 * Aufnahme im Leg ist das die erste Runde.
 */
export function currentRoundNumber(input: {
  readonly currentLegNumber: number;
  readonly visits: readonly RoundVisit[];
}): number {
  const inLeg = input.visits.filter((visit) => visit.legNumber === input.currentLegNumber && !visit.reverted);
  const perPlayer = new Map<string, number>();
  for (const visit of inLeg) perPlayer.set(visit.playerId, (perPlayer.get(visit.playerId) ?? 0) + 1);
  const counts = [...perPlayer.values()];
  return counts.length === 0 ? 1 : Math.min(...counts) + 1;
}

/**
 * Das Ziel des LIVE-Knopfs. Ein freies Match ohne Wettbewerbsbezug führt
 * nirgendwohin; eine Begegnung führt immer auf ihre öffentliche Ansicht,
 * ein Turnier je nach Board-Zuweisung auf die Board- oder die Turnieransicht.
 */
export function liveHref(input: {
  readonly boardId: string | null;
  readonly liveTarget: MatchLiveTarget;
}): string | null {
  if (input.liveTarget === null) return null;
  if (input.liveTarget.kind === "ENCOUNTER") return `/live/begegnungen/${input.liveTarget.publicId}`;
  return input.boardId === null
    ? `/live/${input.liveTarget.tournamentId}`
    : `/live/${input.liveTarget.tournamentId}/board/${input.boardId}`;
}

/**
 * Der Average einer Seite im laufenden Leg, auf drei Darts hochgerechnet.
 * Zurückgenommene Aufnahmen und Aufnahmen ausserhalb des Legs zählen nicht.
 */
export function threeDartAverage(input: {
  readonly visits: readonly AverageVisit[];
  readonly playerIds: readonly string[];
  readonly legNumber: number;
}): number {
  const own = input.visits.filter(
    (visit) => visit.legNumber === input.legNumber && !visit.reverted && input.playerIds.includes(visit.playerId),
  );
  const darts = own.reduce((sum, visit) => sum + visit.dartsThrown, 0);
  if (darts === 0) return 0;
  return (own.reduce((sum, visit) => sum + visit.appliedPoints, 0) / darts) * 3;
}
