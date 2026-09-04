import type { BoardSlotState, QueueReadiness, TournamentStatus } from "@darts-platform/schemas";

/**
 * Presentation only. Nothing here decides anything: every value it formats was
 * already decided by the server.
 *
 * Zeiten gehören der Halle, nicht der Systemuhr des Geräts: ein Spielabend wird
 * als Lokalzeit erfasst und muss als dieselbe Lokalzeit wieder erscheinen.
 * Deshalb wird auf `Europe/Zurich` formatiert und nicht auf UTC — vorher hat
 * eine um 20:00 angesetzte Begegnung als 18:00 dagestanden.
 *
 * Server- und Client-Render dürfen sich dabei weiterhin nicht widersprechen.
 * Die Zone ist deshalb fest verdrahtet statt aus der Umgebung gelesen, und
 * zusammengesetzt wird die Ausgabe hier: aus `Intl` kommen nur die numerischen
 * Bestandteile, deren Form über ICU-Versionen hinweg stabil ist. Die
 * Monatsnamen stehen unten im Modul, damit keine ICU-Wortform in die
 * Hydration einfliesst.
 */

const TOURNAMENT_TIME_ZONE = "Europe/Zurich";

const zonedParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: TOURNAMENT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partsOf(value: Date): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of zonedParts.formatToParts(value)) parts[part.type] = part.value;
  return parts;
}

export function clockTime(value: Date): string {
  const parts = partsOf(value);
  return `${parts.hour}:${parts.minute}`;
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
  const parts = partsOf(value);
  return `${Number(parts.day)}. ${MONTHS[Number(parts.month) - 1]} ${parts.year}`;
}

/** Dieselbe Zone, für Spalten, in denen der ausgeschriebene Monat nicht passt. */
export function calendarDateNumeric(value: Date): string {
  const parts = partsOf(value);
  return `${parts.day}.${parts.month}.${parts.year}`;
}
