import type { PlannedMatch } from "@darts-platform/tournament-engine";

import { clubDuelStageLabel } from "./club-duel-labels.js";

/**
 * Anzeigename der Phase eines geplanten Spiels. Eigene Datei, damit sowohl das
 * Repository als auch die Doppel-K.-o.-Fortschreibung sie nutzen können, ohne
 * einen Importzyklus über das Repository zu bilden.
 */
export function stageLabel(match: PlannedMatch, groupLabels: ReadonlyMap<string, string>): string {
  const clubDuelLabel = clubDuelStageLabel(match);
  if (clubDuelLabel !== null) return clubDuelLabel;
  if (match.stageType === "GROUP" && match.groupKey !== null) {
    return `Gruppe ${groupLabels.get(match.groupKey) ?? match.groupKey}`;
  }
  if (match.stageType === "ROUND_ROBIN") return "Jeder gegen jeden";
  if (match.stageType === "DOUBLE_ELIMINATION_UPPER") return `Gewinnerrunde · Runde ${match.round}`;
  if (match.stageType === "DOUBLE_ELIMINATION_LOWER") return `Verliererrunde · Runde ${match.round}`;
  if (match.stageType === "GRAND_FINAL") return match.round === 1 ? "Final" : "Final-Rückspiel";
  return `K.-o. · Runde ${match.round}`;
}
