import type { Dart, FrequentScores, MatchLiveTarget } from "@darts-platform/schemas";

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
    ? `/live/${input.liveTarget.publicId}`
    : `/live/${input.liveTarget.publicId}/board/${input.boardId}`;
}

/**
 * Kurzbeschriftung eines tatsächlich geworfenen Darts im Dart-Band: `T 5`,
 * `D 20`, `20`, `—` für den Fehlwurf. Segment 25 trägt keinen Ring und
 * bekommt deshalb eigene Wörter statt `D 25`/`25`: `Bull` für den einfachen,
 * `Bullseye` für den doppelten Treffer.
 *
 * Zusammengeführt aus der ursprünglich in `scoreboard-sides.tsx` (Task 11)
 * inline definierten, dort nie aktivierten Fassung: die kannte Segment 25
 * nicht gesondert und zeigte für Bullseye fälschlich „D 25“.
 */
export function dartLabel(dart: Dart): string {
  if (dart.segment === 0) return "—";
  if (dart.segment === 25) return dart.multiplier === 2 ? "Bullseye" : "Bull";
  if (dart.multiplier === 1) return `${dart.segment}`;
  return `${dart.multiplier === 3 ? "T" : "D"} ${dart.segment}`;
}

/**
 * Ausgeschriebene Tastenbeschriftung des Dart-Keypads (`aria-label`), z. B.
 * für Screenreader. `segment` ist hier der Tastenwert (0–20, 25, 50), nicht
 * zwingend ein tatsächlich geworfener Dart: die Taste `50` steht für
 * Bullseye, ihre Abbildung auf `{ segment: 25, multiplier: 2 }` übernimmt
 * der Reducer aus `dart-entry.ts`. Bull und Bullseye tragen keinen
 * Umschalter-Zusatz, weil ihre Tasten den Multiplikator schon im Wert
 * tragen.
 */
export function dartKeypadLabel(segment: number, modifier: 1 | 2 | 3): string {
  if (segment === 0) return "Fehlwurf";
  if (segment === 50) return "Bullseye";
  if (segment === 25) return "Bull";
  return modifier === 3 ? `Triple ${segment}` : modifier === 2 ? `Doppel ${segment}` : `Single ${segment}`;
}

/**
 * Beschriftet die Herkunft der sechs Schnellwerte im Runden-Keypad, damit die
 * Person sieht, ob sie ihre eigenen häufigen Aufnahmen, die Werte der
 * Organisation oder nur den festen Standardsatz vor sich hat (gestufter
 * Endpunkt aus Task 6: Person, sonst Organisation, sonst Standard).
 */
export function quickScoresSourceLabel(source: FrequentScores["source"]): string {
  switch (source) {
    case "PLAYER":
      return "Deine Schnellwerte";
    case "ORGANIZATION":
      return "Vereins-Schnellwerte";
    case "DEFAULT":
      return "Standard-Schnellwerte";
  }
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


/**
 * Was die Flaeche entscheiden lassen muss, bevor wieder gezaehlt werden darf.
 * Beide Lagen meldet der Server im Matchzustand; hergeleitet wird hier nur,
 * welche von beiden gilt.
 */
export type PendingLegDecision =
  | { readonly kind: "LEG_START"; readonly legNumber: number }
  | { readonly kind: "LEG_BY_BULL" };

/**
 * Reglement 2.2.9 (Anwurf ausbullen) und Anhang 2 (Rundengrenze). Ein
 * beendetes oder abgebrochenes Match entscheidet nichts mehr. Die
 * Rundengrenze geht vor: sie beendet das laufende Leg, waehrend der Anwurf
 * ein Leg eroeffnet, das dann bereits laeuft — der Server nimmt dafuer kein
 * `DECIDE_LEG_START` mehr an (`LEG_ALREADY_STARTED`).
 */
export function pendingLegDecision(match: {
  readonly status: string;
  readonly currentLegNumber: number;
  readonly legStartPending: boolean;
  readonly roundLimitReached: boolean;
}): PendingLegDecision | null {
  if (match.status !== "IN_PROGRESS") return null;
  if (match.roundLimitReached) return { kind: "LEG_BY_BULL" };
  return match.legStartPending ? { kind: "LEG_START", legNumber: match.currentLegNumber } : null;
}
