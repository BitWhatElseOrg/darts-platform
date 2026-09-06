import { ApiClientError } from "./api-error";
import type { OfflineCommand, OfflineCommandStatus } from "./offline-command-queue";

/**
 * Was mit einem Kommando geschieht, dessen Wiedergabe fehlgeschlagen ist.
 *
 * - `RETRY`: kein Serverurteil, sondern ein Netzwerkfehler. Das Kommando
 *   bleibt `PENDING` und geht beim naechsten Versuch erneut raus.
 * - `CONFLICT`: der Server steht auf einem anderen Stand oder ein anderes
 *   Geraet steuert das Board. Die Person entscheidet: verwerfen und
 *   synchronisieren oder Steuerung uebernehmen.
 * - `REJECTED`: der Server hat das Kommando fachlich abgelehnt (4xx mit
 *   Fehlercode). Eine Wiederholung wuerde immer wieder scheitern -- das
 *   Kommando ist tot und muss verworfen werden. Vor dieser Unterscheidung
 *   blieb ein solches Kommando dauerhaft `PENDING` und sperrte ueber
 *   `queueBlocksControl` das ganze Board (Befund F2).
 *
 * Endgueltig ist nur, was der Server auch beurteilt hat. Ein Neustart oder
 * eine voruebergehende Stoerung (5xx), ein Zeitablauf (408) und eine
 * Drosselung (429) sind kein Urteil -- eine echte, von Hand erfasste Aufnahme
 * darf daran nicht verloren gehen.
 */
export type ReplayFailure =
  | { readonly kind: "RETRY" }
  | { readonly kind: "CONFLICT"; readonly code: string; readonly message: string }
  | { readonly kind: "REJECTED"; readonly code: string; readonly message: string };

/**
 * Konfliktcodes tragen eigene, handlungsleitende Texte -- die Person soll
 * lesen, was zu tun ist, nicht bloss, dass etwas schiefging.
 */
const conflictMessages: Readonly<Record<string, string>> = {
  MATCH_VERSION_CONFLICT: "Der Serverzustand hat sich geändert. Synchronisiere, bevor du weiterzählst.",
  BOARD_CONTROLLER_CONFLICT: "Ein anderes Gerät steuert dieses Board. Übernimm zuerst die Steuerung.",
  TOURNAMENT_VERSION_CONFLICT: "Der Turnierzustand hat sich geändert. Übernimm den Serverstand und weise erneut zu.",
};

/**
 * Statuscodes, die zum erneuten Versuch einladen: alles ab 500 (der Server
 * kam gar nicht dazu zu urteilen), 408 (Zeitablauf) und 429 (Drosselung).
 * Ein fehlender Status (`null`) zaehlt ebenfalls dazu -- ohne Status ist
 * nicht belegt, dass ein Urteil vorliegt.
 */
function retryableStatus(status: number | null): boolean {
  if (status === null) return true;
  return status >= 500 || status === 408 || status === 429;
}

export function replayFailure(error: unknown): ReplayFailure {
  // Kein `ApiClientError`: Netzwerkfehler, abgebrochene Verbindung oder eine
  // Antwort, die sich nicht als JSON lesen liess (`SyntaxError`).
  if (!(error instanceof ApiClientError)) return { kind: "RETRY" };
  const conflict = conflictMessages[error.code];
  if (conflict !== undefined) return { kind: "CONFLICT", code: error.code, message: conflict };
  if (retryableStatus(error.status)) return { kind: "RETRY" };
  return { kind: "REJECTED", code: error.code, message: error.message };
}

/**
 * Die Kommandos, die jetzt uebertragen werden duerfen: der fuehrende Block
 * wartender Kommandos. Beim ersten Eintrag, der nicht `PENDING` ist, endet
 * die Wiedergabe.
 *
 * Ein Filter statt eines Abbruchs hielte die Reihenfolge nur innerhalb eines
 * Durchgangs. Beim naechsten Auslöser (Neuladen, `online`-Ereignis, „Jetzt
 * uebertragen") uebersprang er den abgelehnten oder konfliktbehafteten Kopf
 * und setzte dessen Nachfolger ab -- der ging durch, weil der Kopf nie
 * angewendet wurde und die gespeicherte `expectedVersion` deshalb wieder
 * passte. Ergebnis: die zweite Aufnahme steht in der Datenbank, die erste
 * nicht. Erst wenn der Kopf verworfen oder synchronisiert ist, geht es
 * weiter.
 */
export function nextReplayable<T extends { readonly status: OfflineCommandStatus }>(
  commands: readonly T[],
): readonly T[] {
  const blocked = commands.findIndex((command) => command.status !== "PENDING");
  return blocked === -1 ? commands : commands.slice(0, blocked);
}

/**
 * Sperrt die Warteschlange die Bedienung?
 *
 * Ja, solange sie ein Kommando traegt, das noch uebertragen werden soll oder
 * muss: `PENDING` (wartet auf die Verbindung) und `CONFLICT` (wartet auf eine
 * Entscheidung) stehen beide vor dem Serverstand, und eine neue Aufnahme
 * daneben liefe an ihnen vorbei -- die Reihenfolge waere dahin.
 *
 * Ein `REJECTED` sperrt NICHT: der Server hat es abgelehnt, es ist nie
 * geschehen und wird nie geschehen. Es bleibt sichtbar in der Warteschlange,
 * bis es verworfen wird -- kein stiller Datenverlust --, aber es macht das
 * Board nicht unbedienbar. Steht ein `PENDING` dahinter, sperrt dieses; die
 * Wiedergabe bricht am abgelehnten Kommando ohnehin ab, damit die Reihenfolge
 * haelt.
 */
export function queueBlocksControl(queued: readonly OfflineCommand[]): boolean {
  return queued.some((command) => command.status === "PENDING" || command.status === "CONFLICT");
}

export interface QueuedCommandNotice {
  readonly text: string;
  /** `DISCARD`: nur Verwerfen hilft. `RETRY`: erneut uebertragen ist sinnvoll. */
  readonly action: "DISCARD" | "RETRY";
}

/**
 * Was die Warteschlangenansicht zu einem Kommando sagt.
 *
 * `pendingOnline` benennt, was mit einem wartenden Kommando bei bestehender
 * Verbindung geschieht: die Scoringflaeche wiederholt von selbst, die
 * Kommandozentrale wartet auf den Knopf.
 */
export function queuedCommandNotice(
  command: OfflineCommand,
  online: boolean,
  pendingOnline = "Wiederholung läuft",
): QueuedCommandNotice {
  switch (command.status) {
    case "CONFLICT":
      return { text: `${command.label} · ${command.error ?? "Konflikt mit dem Serverstand"}`, action: "DISCARD" };
    case "REJECTED":
      return { text: `${command.label} · Vom Server abgelehnt: ${command.error ?? "unbekannter Grund"}`, action: "DISCARD" };
    case "PENDING":
      return { text: `${command.label} · ${online ? pendingOnline : "Offline"}`, action: "RETRY" };
  }
}
