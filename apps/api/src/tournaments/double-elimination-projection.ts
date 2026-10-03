import type { BracketSection } from "@darts-platform/schemas";
import {
  doubleEliminationPlacements,
  GRAND_FINAL_KEY,
  GRAND_FINAL_RESET_KEY,
  type DoubleEliminationMatchResult,
} from "@darts-platform/tournament-engine";

type DoubleEliminationStageType = DoubleEliminationMatchResult["stageType"];

const STAGE_SECTIONS: ReadonlyMap<string, BracketSection> = new Map([
  ["DOUBLE_ELIMINATION_UPPER", "UPPER"],
  ["DOUBLE_ELIMINATION_LOWER", "LOWER"],
  ["GRAND_FINAL", "GRAND_FINAL"],
]);

/**
 * Abschnitt eines Spiels im Tableau. Einfach-K.-o. bleibt bei der bisherigen
 * Erkennung über das Label («K.-o. · Runde N»), damit das Final des
 * Vereinsduells nicht im Baum landet.
 */
export function bracketSectionOf(stageType: string | undefined, stageLabel: string): BracketSection | null {
  const section = stageType === undefined ? undefined : STAGE_SECTIONS.get(stageType);
  if (section !== undefined) return section;
  return stageLabel.startsWith("K.-o.") ? "MAIN" : null;
}

export interface DoubleEliminationMatchRow {
  readonly key: string;
  readonly stageId: string;
  readonly round: number;
  readonly status: string;
  readonly resultType: string | null;
  readonly participantOneId: string | null;
  readonly participantTwoId: string | null;
  readonly winnerPlayerId: string | null;
}

export function projectDoubleElimination(input: {
  readonly participants: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly matches: readonly DoubleEliminationMatchRow[];
  readonly stageTypeById: ReadonlyMap<string, string>;
}): { readonly placements: readonly { rank: number; playerId: string; displayName: string }[]; readonly resetPossible: boolean } {
  const results: DoubleEliminationMatchResult[] = input.matches.flatMap((match) => {
    const stageType = input.stageTypeById.get(match.stageId);
    if (stageType === undefined || !STAGE_SECTIONS.has(stageType)) return [];
    // Die DB-Checks garantieren die Werte (Muster wie apply-withdrawal-propagation).
    return [{
      key: match.key,
      stageType: stageType as DoubleEliminationStageType,
      round: match.round,
      status: match.status as DoubleEliminationMatchResult["status"],
      resultType: match.resultType as DoubleEliminationMatchResult["resultType"],
      participantOneId: match.participantOneId,
      participantTwoId: match.participantTwoId,
      winnerPlayerId: match.winnerPlayerId,
    }];
  });
  const names = new Map(input.participants.map((participant) => [participant.playerId, participant.displayName]));
  const final = results.find((match) => match.key === GRAND_FINAL_KEY);
  const reset = results.find((match) => match.key === GRAND_FINAL_RESET_KEY);
  return {
    placements: doubleEliminationPlacements({ playerIds: input.participants.map((participant) => participant.playerId), matches: results })
      .map((entry) => ({ ...entry, displayName: names.get(entry.playerId) ?? "Unbekannter Teilnehmer" })),
    resetPossible: reset === undefined && final !== undefined && final.status !== "COMPLETED",
  };
}
