import type { BracketMatch, TournamentStatus } from "@darts-platform/schemas";

/**
 * Der Server liefert das K.-o.-Tableau als flache Liste mit `round` und
 * `position` (siehe `tournaments.service.ts`). Diese Ableitung macht daraus
 * die Runden des Turnierbaums — die Ansicht entscheidet nichts, sie zeigt
 * nur, was der Server geschickt hat (AGENTS.md §4).
 */

/** Platzhalter, den der Server für einen noch unbesetzten Platz sendet. */
const OPEN_PARTICIPANT = "Noch offen";

const ROUND_NAMES_FROM_FINAL = ["Final", "Halbfinal", "Viertelfinal", "Achtelfinal"] as const;

export type BracketSlotState = "WINNER" | "LOSER" | "OPEN" | "UNDECIDED";

export interface BracketSlot {
  readonly displayName: string;
  readonly state: BracketSlotState;
}

export interface BracketNode {
  readonly matchId: string;
  readonly position: number;
  readonly status: BracketMatch["status"];
  /** Kurzer Hinweis auf einen Sonderfall — sonst `null`. */
  readonly note: string | null;
  readonly slots: readonly [BracketSlot, BracketSlot];
}

export interface BracketRound {
  readonly round: number;
  readonly label: string;
  readonly matches: readonly BracketNode[];
}

function slotOf(match: BracketMatch, index: 0 | 1): BracketSlot {
  const displayName = match.participantNames[index];
  if (displayName === OPEN_PARTICIPANT) return { displayName, state: "OPEN" };
  if (match.winnerDisplayName === null) return { displayName, state: "UNDECIDED" };
  return {
    displayName,
    state: displayName === match.winnerDisplayName ? "WINNER" : "LOSER",
  };
}

function noteOf(match: BracketMatch): string | null {
  if (match.resultType === "BYE") return "Freilos";
  if (match.resultType === "WALKOVER") return "Walkover";
  if (match.status === "IN_PROGRESS") return "Läuft";
  if (match.status === "CANCELLED") return "Entfällt";
  return null;
}

function nodeOf(match: BracketMatch): BracketNode {
  return {
    matchId: match.matchId,
    position: match.position,
    status: match.status,
    note: noteOf(match),
    slots: [slotOf(match, 0), slotOf(match, 1)],
  };
}

/**
 * Der Rundenname zählt vom Final rückwärts, nicht von vorne: erst dadurch
 * heisst die letzte Runde eines Tableaus mit vier Qualifizierten «Final» und
 * nicht «Runde 2».
 */
function labelOf(round: number, lastRound: number): string {
  return ROUND_NAMES_FROM_FINAL[lastRound - round] ?? `Runde ${round}`;
}

export function buildBracketRounds(matches: readonly BracketMatch[]): readonly BracketRound[] {
  if (matches.length === 0) return [];
  const byRound = new Map<number, BracketMatch[]>();
  for (const match of matches) {
    const bucket = byRound.get(match.round);
    if (bucket === undefined) byRound.set(match.round, [match]);
    else bucket.push(match);
  }
  const rounds = [...byRound.keys()].sort((left, right) => left - right);
  const lastRound = rounds[rounds.length - 1] ?? 0;
  return rounds.map((round) => ({
    round,
    label: labelOf(round, lastRound),
    matches: (byRound.get(round) ?? [])
      .slice()
      .sort((left, right) => left.position - right.position)
      .map(nodeOf),
  }));
}

/**
 * Ab der K.-o.-Phase ist das Tableau die wichtigere Information, die
 * Gruppenphase nur noch Herkunft. Nach dem Turnierende gilt dasselbe: der
 * Baum trägt den Sieg, nicht die Gruppentabelle.
 */
export function knockoutLeadsLiveView(status: TournamentStatus): boolean {
  return status === "KNOCKOUT" || status === "COMPLETED";
}
