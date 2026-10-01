import type { TournamentFormat, TournamentStatus } from "@darts-platform/schemas";

/** Bezeichnung der einzigen Phase eines Jeder-gegen-jeden-Turniers (auch Match-Stage-Label im Repository). */
export const ROUND_ROBIN_LABEL = "Jeder gegen jeden";

/**
 * Phasenbezeichnung fuer `tournament.stageLabel` im Dashboard (Command Centre
 * und oeffentliche Live-Ansicht). Das Vereinsduell kennt keine Gruppenphase:
 * seine Status GROUP_STAGE/FINAL_ROUND/KNOCKOUT stehen fuer Qualifikation,
 * Finalrunde und Final. `clubDuelRound` ist `null`, wenn die Projektion nicht
 * zustande kam (Ruling R11) - dann bleibt es bei «Qualifikation».
 */
export function tournamentStageLabel(input: {
  readonly status: TournamentStatus;
  readonly format: TournamentFormat;
  readonly clubDuelRound: number | null;
}): string {
  if (input.format === "CLUB_DUEL") {
    switch (input.status) {
      case "GROUP_STAGE":
        return input.clubDuelRound === null ? "Qualifikation" : `Qualifikation · Runde ${input.clubDuelRound}`;
      case "FINAL_ROUND":
        return "Finalrunde";
      case "KNOCKOUT":
        return "Final";
      case "COMPLETED":
        return "Turnier beendet";
      case "DRAFT":
      case "READY":
        return "Startbereit";
    }
  }
  switch (input.status) {
    case "GROUP_STAGE":
      return input.format === "ROUND_ROBIN" ? ROUND_ROBIN_LABEL : "Gruppenphase";
    case "KNOCKOUT":
      return "K.-o.-Runde";
    case "COMPLETED":
      return "Turnier beendet";
    case "DRAFT":
    case "READY":
    case "FINAL_ROUND":
      return "Startbereit";
  }
}
