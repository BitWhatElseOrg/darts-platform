/**
 * Wer ein beendetes Turnier gewonnen hat -- fuer die Kopfzeilen von
 * Kommandozentrale und Live-Ansicht (Probelauf 25.09.2026, Befund 8).
 *
 * Mit Tableau entscheidet das Match der hoechsten Runde; ohne Tableau (Round
 * Robin) die Spitze der einzigen Gruppe. Mehrere Gruppen ohne Tableau haben
 * keinen einen Sieger, und ein noch offenes letztes Match auch nicht: dann
 * `null`, und die Kopfzeile bleibt, wie sie ist.
 */
interface WinnerSource {
  readonly tournament: { readonly status: string };
  readonly bracket: readonly { readonly round: number; readonly status: string; readonly winnerDisplayName: string | null }[];
  readonly groups: readonly { readonly rows: readonly { readonly position: number; readonly displayName: string }[] }[];
}

export function tournamentWinner(source: WinnerSource): string | null {
  if (source.tournament.status !== "COMPLETED") return null;
  if (source.bracket.length > 0) {
    const lastRound = Math.max(...source.bracket.map((match) => match.round));
    const decider = source.bracket.find((match) => match.round === lastRound);
    return decider?.status === "COMPLETED" ? decider.winnerDisplayName : null;
  }
  if (source.groups.length !== 1) return null;
  return source.groups[0]?.rows.find((row) => row.position === 1)?.displayName ?? null;
}
