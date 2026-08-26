import type { BoardSlotState, QueueReadiness, TournamentStatus } from "@darts-platform/schemas";

/**
 * Presentation only. Nothing here decides anything: every value it formats was
 * already decided by the server. Times are formatted from UTC on purpose, so a
 * server render and a client render cannot disagree.
 */

export function clockTime(value: Date): string {
  return `${value.toISOString().slice(11, 13)}:${value.toISOString().slice(14, 16)}`;
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

export function runtimeLabel(minutes: number): string {
  return `${minutes} Min`;
}

export function boardStateLabel(state: BoardSlotState): string {
  switch (state) {
    case "FREE":
      return "frei";
    case "PLAYING":
      return "läuft";
    case "BLOCKED":
      return "gesperrt";
  }
}

export function readinessLabel(readiness: QueueReadiness): string {
  switch (readiness) {
    case "READY":
      return "bereit";
    case "BLOCKED_PLAYER_BUSY":
      return "Spieler belegt";
    case "BLOCKED_PARTICIPANT_UNDECIDED":
      return "Teilnehmer offen";
    case "BLOCKED_NO_BOARD":
      return "kein Board";
    case "BLOCKED_STAGE_NOT_OPEN":
      return "Phase zu";
  }
}

export function statusLabel(status: TournamentStatus): string {
  switch (status) {
    case "DRAFT":
      return "Entwurf";
    case "READY":
      return "startbereit";
    case "GROUP_STAGE":
      return "Gruppenphase";
    case "KNOCKOUT":
      return "K.-o.-Runde";
    case "COMPLETED":
      return "beendet";
  }
}

const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

export function calendarDate(value: Date): string {
  return `${value.getUTCDate()}. ${MONTHS[value.getUTCMonth()]} ${value.getUTCFullYear()}`;
}
