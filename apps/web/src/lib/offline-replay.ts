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

/**
 * Meldung fuer ein Kommando, das der Server bereits angenommen hat, dessen
 * lokale Nacharbeit (Warteschlangeneintrag entfernen, Ansicht aktualisieren)
 * aber gescheitert ist -- etwa weil IndexedDB gerade nicht verfuegbar ist.
 *
 * Anders als bei `replayFailure` liegt hier schon ein Urteil des Servers vor,
 * und es war positiv. Ein Fehler an dieser Stelle ist rein lokal und darf
 * NICHT ueber `replayFailure`/`markOfflineCommand*` erneut klassifiziert
 * werden -- sonst zeigt die Person einen Uebertragungsfehler fuer einen
 * Vorgang, der laengst durch ist, und ein bereits angenommenes Kommando
 * landet erneut in der Warteschlange (PR-Agent-Befund F2).
 */
export function localCleanupFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "unbekannter Fehler";
  return `Der Server hat den Befehl angenommen, die lokale Warteschlange konnte aber nicht aktualisiert werden (${detail}). Bitte Seite neu laden.`;
}

/**
 * Meldung fuer den Offline-Zweig, bevor ueberhaupt ein Server beteiligt war:
 * das Kommando sollte in die lokale Warteschlange (IndexedDB) gelegt werden,
 * doch schon das Ablegen scheiterte -- etwa weil IndexedDB nicht verfuegbar
 * ist, blockiert oder die Quota ueberschritten wurde.
 *
 * Anders als `localCleanupFailureMessage` liegt hier noch KEIN Urteil vor:
 * das Kommando ist weder gesendet noch gespeichert. Ohne sichtbare Meldung
 * verschwindet es kommentarlos -- versteckter Datenverlust (AGENTS.md §18,
 * PR-Agent-Runde 3, Befund A).
 */
export function queueSaveFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "unbekannter Fehler";
  return `Zuweisung konnte nicht in die Warteschlange gelegt werden (${detail}). Bitte Verbindung wiederherstellen und erneut versuchen.`;
}

/**
 * Meldung fuer das Lesen der lokalen Warteschlange (IndexedDB), das selbst
 * gescheitert ist -- beim Betreten der Zentrale oder nach einer Aenderung.
 *
 * Ohne sie zeigt die Zentrale eine leere Warteschlange, und die Person haelt
 * sie fuer leer: bestehende wartende Zuweisungen sind dann still ausgelassen,
 * obwohl sie in IndexedDB stehen und beim naechsten Lesen wieder auftauchen.
 * Die Warteschlange muss sichtbar sein (AGENTS.md §18), auch wenn genau ihr
 * Lesen scheitert (PR-Agent-Runde 5, Befund b).
 */
export function queueReadFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "unbekannter Fehler";
  return `Die Warteschlange konnte nicht gelesen werden (${detail}). Wartende Zuweisungen werden möglicherweise nicht angezeigt. Lade die Seite neu, bevor du erneut zuweist.`;
}

/**
 * Meldung fuer eine gescheiterte Aenderung an der lokalen Warteschlange:
 * einen Ausgang markieren (Konflikt, Ablehnung) oder einen Eintrag verwerfen.
 *
 * Anders als beim Lesen ist hier eine beabsichtigte Aenderung nicht
 * angekommen: der Eintrag steht noch so da wie vorher. Ohne Meldung sieht die
 * Person einen unveraenderten Eintrag und keinen Grund dafuer.
 */
export function queueUpdateFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "unbekannter Fehler";
  return `Die Warteschlange konnte nicht geändert werden (${detail}). Der Eintrag steht unverändert weiter in der Liste. Lade die Seite neu und versuche es erneut.`;
}

/**
 * Ergebnis eines einzelnen Wiedergabeversuchs. `version` ist die vom Server
 * bestaetigte neue Version -- nur bei Erfolg vorhanden, weil ein
 * Fehlschlag kein Urteil ueber die Version liefert.
 */
export type ReplayOutcome =
  | { readonly successful: true; readonly version: number }
  | { readonly successful: false };

export interface ReplayResult {
  /** Wie viele Kommandos tatsaechlich durchgingen, bevor entweder alle durch waren oder eines fehlschlug. */
  readonly sentCount: number;
}

/**
 * Ueberträgt eine geordnete Folge wartender Kommandos und haelt dabei die
 * `expectedVersion` jedes Kommandos aktuell: das erste bekommt `startVersion`
 * -- den zuletzt bestaetigten Serverstand --, jedes folgende die Version aus
 * der erfolgreichen Antwort auf das vorherige.
 *
 * Eine beim Einreihen gespeicherte, moeglicherweise eingefrorene
 * `expectedVersion` fliesst hier bewusst nicht ein. Vorher trug jedes
 * Kommando seine beim Einreihen berechnete Version fest in sich, ohne
 * Ruecksicht auf inzwischen verworfene Vorgaenger: ein verworfenes Kommando
 * wurde trotzdem mitgezaehlt, und die Nachfolger sendeten eine Version, die
 * der Server nie erreichen konnte -- sie konfligierten sofort, obwohl sich
 * am echten Serverzustand nichts geaendert hatte (PR-Agent-Befund F2,
 * "Stale Versions"). Ein Konflikt entsteht mit dieser Kette nur noch, wenn
 * tatsaechlich jemand anderes den Zustand veraendert hat.
 *
 * Bricht beim ersten Fehlschlag ab: die Reihenfolge ist verbindlich, kein
 * Nachfolger darf vor seinem Vorgaenger ankommen.
 *
 * Gemeinsam genutzt von der Kommandozentrale (Board-Zuweisungen) und der
 * Scoringflaeche (Einzelaufnahmen) -- beide reihen Kommandos in derselben
 * IndexedDB-Warteschlange ein und muessen dieselbe Versionskette bilden.
 */
export async function replayWithCurrentVersion<T>(
  commands: readonly T[],
  startVersion: number,
  send: (command: T, expectedVersion: number) => Promise<ReplayOutcome>,
): Promise<ReplayResult> {
  let version = startVersion;
  let sentCount = 0;
  for (const command of commands) {
    const outcome = await send(command, version);
    if (!outcome.successful) break;
    sentCount += 1;
    version = outcome.version;
  }
  return { sentCount };
}

/**
 * Ersetzt die `expectedVersion` einer gespeicherten Kommando-Nutzlast durch
 * die waehrend der Wiedergabe aufgebaute, aktuelle Version. Die gespeicherte
 * Version ist seit PR-Agent-Befund F2 ("Stale Versions") nur noch ein
 * Anzeigehinweis und kann veraltet sein -- etwa weil ein davorstehendes
 * Kommando inzwischen verworfen wurde. Alle uebrigen Felder der Nutzlast
 * (Punkte, Einzelwuerfe, Checkout-Angaben, ...) bleiben unveraendert.
 */
export function withCurrentExpectedVersion(
  body: Readonly<Record<string, unknown>>,
  expectedVersion: number,
): Readonly<Record<string, unknown>> {
  return { ...body, expectedVersion };
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
