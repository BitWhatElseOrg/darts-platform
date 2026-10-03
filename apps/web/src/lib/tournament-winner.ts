import type { TournamentDashboard } from "@darts-platform/schemas";

/**
 * Wer ein beendetes Turnier gewonnen hat -- fuer die Kopfzeilen von
 * Kommandozentrale und Live-Ansicht (Probelauf 25.09.2026, Befund 8).
 *
 * Mit Tableau entscheidet das Match der hoechsten Runde; ohne Tableau (Round
 * Robin) die Spitze der einzigen Gruppe. Mehrere Gruppen ohne Tableau haben
 * keinen einen Sieger, und ein noch offenes letztes Match auch nicht: dann
 * `null`, und die Kopfzeile bleibt, wie sie ist. Im Vereinsduell entscheidet
 * das Final; der Name kommt ueber `participants`.
 */
interface WinnerSource {
  readonly tournament: { readonly status: string };
  readonly bracket: readonly { readonly round: number; readonly status: string; readonly winnerDisplayName: string | null }[];
  readonly groups: readonly { readonly rows: readonly { readonly position: number; readonly displayName: string }[] }[];
  readonly participants?: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly doubleElimination?: TournamentDashboard["doubleElimination"];
  readonly clubDuel?: {
    readonly finals: { readonly final: { readonly status: string; readonly winnerPlayerId: string | null } | null };
  } | null;
}

export function tournamentWinner(source: WinnerSource): string | null {
  if (source.tournament.status !== "COMPLETED") return null;
  // Vereinsduell: Sieger ist, wer das Final gewinnt -- nicht der Verein.
  const final = source.clubDuel?.finals.final;
  if (final !== undefined && final !== null) {
    if (final.status !== "COMPLETED" || final.winnerPlayerId === null) return null;
    return source.participants?.find((participant) => participant.playerId === final.winnerPlayerId)?.displayName ?? null;
  }
  // Doppel-K.-o.: Sieger aus der Schlussrangliste des Servers -- das letzte
  // Spiel im Baum kann das erste Final sein, obwohl ein Rückspiel folgte.
  if (source.doubleElimination !== undefined && source.doubleElimination !== null) {
    return source.doubleElimination.placements.find((entry) => entry.rank === 1)?.displayName ?? null;
  }
  if (source.bracket.length > 0) {
    const lastRound = Math.max(...source.bracket.map((match) => match.round));
    const decider = source.bracket.find((match) => match.round === lastRound);
    return decider?.status === "COMPLETED" ? decider.winnerDisplayName : null;
  }
  if (source.groups.length !== 1) return null;
  return source.groups[0]?.rows.find((row) => row.position === 1)?.displayName ?? null;
}
