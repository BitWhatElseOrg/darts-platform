import { CLUB_DUEL_STAGE_KEYS, type PlannedMatch } from "@darts-platform/tournament-engine";

export function qualifyingRoundLabel(round: number): string {
  return `Quali · Runde ${round}`;
}

/** Beschriftung der Vereinsduell-Phasen; null für Spiele anderer Formate. */
export function clubDuelStageLabel(
  match: Pick<PlannedMatch, "stageKey" | "round" | "position">,
): string | null {
  if (match.stageKey === CLUB_DUEL_STAGE_KEYS.qualifying) return qualifyingRoundLabel(match.round);
  if (match.stageKey === CLUB_DUEL_STAGE_KEYS.finalRound) return `Finalrunde · Runde ${match.round}`;
  if (match.stageKey === CLUB_DUEL_STAGE_KEYS.final) return match.position === 1 ? "Final" : "Spiel um Platz 3";
  return null;
}
