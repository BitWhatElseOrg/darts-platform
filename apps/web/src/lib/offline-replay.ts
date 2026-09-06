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
 *   `queueBlocksControl` das ganze Board (Befund F2). Ausnahme: 401 (siehe
 *   `replayFailure`) ist trotz 4xx kein Urteil ueber das Kommando.
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
  // 401 bekommt eine eigene Zeile statt in `retryableStatus` aufzugehen: die
  // Session ist waehrend der Wiedergabe abgelaufen, das ist kein Urteil ueber
  // das Kommando selbst. Nach erneuter Anmeldung und einem neuen
  // Wiedergabelauf kann dasselbe Kommando durchgehen -- als `REJECTED` waere
  // es endgueltig verworfen, obwohl es fachlich gueltig ist und die
  // Nachfolger unnoetig anhaelt (Befund B). 403 bleibt `REJECTED`: fehlende
  // Berechtigung ist kein voruebergehender Zustand und behebt sich nicht
  // durch einen erneuten Versuch.
  if (error.status === 401) return { kind: "RETRY" };
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
 *
 * `acceptedButStuck` traegt die `commandId`s, die der Server bereits
 * angenommen hat und die nur lokal nicht entfernt werden konnten
 * (`use-offline-queue.ts`). Sie stehen NICHT mehr vor dem Serverstand -- er
 * kennt sie -- und duerfen die Flaeche deshalb nicht sperren. Ohne diese
 * Ausnahme blieb die Scoringflaeche nach einem gescheiterten lokalen
 * Aufraeumen dauerhaft unbedienbar (Runde 7).
 *
 * `readError` sperrt bedingungslos, UNABHAENGIG vom Inhalt von `queued`: ein
 * gescheitertes Lesen kann Eintraege verbergen (`queued` erscheint dann leer
 * oder auf dem letzten guten Stand), und genau das ist die Eigenschaft, die
 * diese Funktion prueft -- kann ein verstecktes wartendes Kommando von der
 * Bedienung ueberholt werden? Ein Schreibfehler (`writeError` in
 * `use-offline-queue.ts`) ist bewusst KEIN Parameter: er laesst den
 * betroffenen Eintrag unveraendert sichtbar stehen und verbirgt nichts.
 * `acceptedButStuck` verbirgt ebenfalls nichts -- der Server kennt den
 * Eintrag bereits. Die Regel fuer einen kuenftigen vierten Zustand: sperrt er
 * nur, wenn er Eintraege verbergen kann (PR-Agent-Rueckmeldung Runde 9,
 * "Unsafe Control" / "Unsafe Assignment").
 */
export function queueBlocksControl(
  queued: readonly OfflineCommand[],
  acceptedButStuck: ReadonlySet<string>,
  readError: string | null,
): boolean {
  if (readError !== null) return true;
  return queued.some(
    (command) =>
      (command.status === "PENDING" || command.status === "CONFLICT") &&
      !acceptedButStuck.has(command.commandId),
  );
}

/**
 * Sperrt die Zuweisungs-Controls der Kommandozentrale (`command-centre.tsx`)?
 *
 * Anders als `queueBlocksControl` (Scoringflaeche) sperrt sie NICHT schon bei
 * einem wartenden oder konfliktbehafteten Kommando: `pendingBoardIds` und
 * `pendingMatchIds` verhindern dort bereits eine zweite Zuweisung auf
 * dasselbe Board oder Match, und `nextReplayable`/`replayChained` tragen die
 * Reihenfolge der Wiedergabe. Ein WEITERES freies Board oder Match darf waehrend
 * einer laufenden Wiedergabe zugewiesen werden -- eine einzelne Offline-
 * Zuweisung darf nicht die ganze Zentrale sperren, solange keine Eintraege
 * verborgen sind. Vorher nutzte die Zentrale `queueBlocksControl` und
 * blockierte nach der ersten Offline-Zuweisung jede weitere, auch fuer voellig
 * andere Boards und Matches (PR-Agent-Rueckmeldung Runde 10, Regression seit
 * Runde 9).
 *
 * Sie sperrt NUR, wenn ein Zustand Eintraege VERBERGEN kann -- heute
 * ausschliesslich `readError` (siehe die Regel in `use-offline-queue.ts`):
 * `queued` erscheint dann leer oder auf dem letzten guten Stand, und
 * `pendingBoardIds`/`pendingMatchIds` koennten ein tatsaechlich wartendes
 * Kommando nicht mehr erkennen -- genau dieselbe Gefahr, die
 * `queueBlocksControl` fuer den Lesefehler-Fall traegt.
 */
export function queueHidesEntries(readError: string | null): boolean {
  return readError !== null;
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
 *
 * `subject` benennt, was nicht abgelegt werden konnte: die Kommandozentrale
 * legt Zuweisungen ab, die Scoringflaeche Aufnahmen. Vorher stand "Zuweisung"
 * fest im Text, und die Scoringflaeche zeigte fuer eine nicht gespeicherte
 * Aufnahme entweder eine falsche Bezeichnung oder gar keine Meldung.
 */
export function queueSaveFailureMessage(error: unknown, subject = "Zuweisung"): string {
  const detail = error instanceof Error ? error.message : "unbekannter Fehler";
  return `${subject} konnte nicht in die Warteschlange gelegt werden (${detail}). Bitte Verbindung wiederherstellen und erneut versuchen.`;
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
 *
 * Nennt seit Runde 9 auch die Folge: `queueBlocksControl` sperrt bei diesem
 * Zustand bedingungslos (Scoring bzw. Zuweisen). Ohne diesen Satz sah die
 * Person eine gesperrte Bedienung ohne erkennbaren Grund -- die Meldung stand
 * zwar daneben, sagte aber nicht, dass genau sie die Sperre ausloest.
 */
export function queueReadFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "unbekannter Fehler";
  return `Die Warteschlange konnte nicht gelesen werden (${detail}). Wartende Kommandos werden möglicherweise nicht angezeigt; deshalb ist die Bedienung gesperrt, bis das Lesen wieder gelingt. Lade die Seite neu.`;
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
 * Ergebnis eines einzelnen Wiedergabeversuchs.
 *
 * `successful` heisst: der Server hat angenommen UND die lokale Nacharbeit
 * ist durch -- nur dann darf der Nachfolger losgehen. `version` ist die vom
 * Server bestaetigte neue Version; sie gibt es nur bei Erfolg, weil ein
 * Fehlschlag kein Urteil ueber die Version liefert.
 *
 * `accepted` trennt im Fehlerfall die beiden Gruende: `false` heisst, der
 * Server hat NICHT angenommen (Netz, Konflikt, fachliche Ablehnung); `true`
 * heisst, er hat angenommen und nur das lokale Aufraeumen scheiterte. Die
 * Kette bricht in beiden Faellen ab -- die Reihenfolge ist verbindlich --,
 * aber im zweiten Fall hat sich der Serverstand bewegt und die Ansicht muss
 * nachgeladen werden (Runde 8, Befund B).
 */
export type ReplayOutcome =
  | { readonly successful: true; readonly version: number }
  | { readonly successful: false; readonly accepted: boolean };

export interface ReplayResult {
  /** Wie viele Kommandos vollstaendig durchgingen: gesendet und lokal aufgeraeumt. */
  readonly sentCount: number;
  /**
   * Wie viele der Server angenommen hat -- immer `sentCount` oder eins mehr:
   * das Kommando, an dem die Kette wegen eines lokalen Aufraeumfehlers
   * abbrach, zaehlt hier mit.
   *
   * Wer die Ansicht nachladen will, fragt diesen Wert. `sentCount` allein
   * liess den Refresh nach einem Aufraeumfehler aus, obwohl der Serverstand
   * sich bewegt hatte -- die naechste Aufnahme lief danach gegen einen
   * veralteten Cache und eine veraltete Version (Runde 8, Befund B).
   */
  readonly acceptedCount: number;
}

/**
 * Ueberträgt eine geordnete Folge wartender Kommandos und verkettet dabei die
 * `expectedVersion`: der KOPF sendet die beim Einreihen gespeicherte Version
 * -- die letzte Serverversion, die dieses Geraet gesehen hat --, jeder
 * Nachfolger die Version aus der erfolgreichen Antwort auf seinen Vorgaenger.
 * Der Kopf ist daran erkennbar, dass `send` fuer ihn `null` als verkettete
 * Version bekommt; er nimmt dann seine eigene, gespeicherte.
 *
 * Warum der Kopf seine gespeicherte Version behaelt: sie ist der Stand, auf
 * dem die Aufnahme fachlich beruht. Hat sich der Server waehrend der
 * Offline-Zeit unabhaengig bewegt -- ein anderes Geraet hat gescort, eine
 * Korrektur wurde gebucht --, MUSS die Wiedergabe daran konfligieren, damit
 * die Person entscheidet, statt eine veraltete Aufnahme stillschweigend auf
 * einen fremden Zustand zu setzen (ADR 0008: „Versionskonflikte werden nie
 * automatisch verworfen"; AGENTS.md §12). Vorher bekam der Kopf den frisch
 * geladenen Serverstand untergeschoben und ging deshalb IMMER durch -- fuer
 * ihn war die Divergenzerkennung ausgehebelt (Runde 8, Befund A).
 *
 * Das Verwerfen eines konfliktbehafteten Kopfes bleibt damit vertraeglich:
 * der nachrueckende Kopf traegt ebenfalls die zuletzt gesehene Serverversion.
 * Steht der Server noch dort, geht er durch; hat er sich bewegt, konfligiert
 * er zu Recht. Eine um die Zahl wartender Kommandos hochgerechnete Version
 * speichert beim Einreihen niemand mehr (PR-Agent-Befund F2, „Stale
 * Versions"); die Nachfolger ketten ausschliesslich aus tatsaechlichen
 * Antworten.
 *
 * Bricht beim ersten Fehlschlag ab: die Reihenfolge ist verbindlich, kein
 * Nachfolger darf vor seinem Vorgaenger ankommen.
 *
 * Gemeinsam genutzt von der Kommandozentrale (Board-Zuweisungen) und der
 * Scoringflaeche (Einzelaufnahmen) -- beide reihen Kommandos in derselben
 * IndexedDB-Warteschlange ein und muessen dieselbe Versionskette bilden.
 */
export async function replayChained<T>(
  commands: readonly T[],
  send: (command: T, chainedVersion: number | null) => Promise<ReplayOutcome>,
): Promise<ReplayResult> {
  let chainedVersion: number | null = null;
  let sentCount = 0;
  let acceptedCount = 0;
  for (const command of commands) {
    const outcome = await send(command, chainedVersion);
    if (!outcome.successful) {
      if (outcome.accepted) acceptedCount += 1;
      break;
    }
    sentCount += 1;
    acceptedCount += 1;
    chainedVersion = outcome.version;
  }
  return { sentCount, acceptedCount };
}

/**
 * Ersetzt die `expectedVersion` einer gespeicherten Kommando-Nutzlast durch
 * die waehrend der Wiedergabe aufgebaute, verkettete Version. Gilt nur fuer
 * NACHFOLGER: deren gespeicherte Version kann veraltet sein, weil ein
 * davorstehendes Kommando verworfen wurde oder weil der Vorgaenger den
 * Serverstand gerade selbst weitergeschoben hat. Der Kopf sendet seine
 * gespeicherte Version unveraendert (`replayChained`). Alle uebrigen Felder
 * der Nutzlast (Punkte, Einzelwuerfe, Checkout-Angaben, ...) bleiben
 * unveraendert.
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

export interface QueuedCommandView {
  readonly online: boolean;
  /**
   * Was mit einem wartenden Kommando bei bestehender Verbindung geschieht:
   * die Scoringflaeche wiederholt von selbst, die Kommandozentrale wartet auf
   * den Knopf.
   */
  readonly pendingOnline?: string;
  /**
   * Der Server hat genau dieses Kommando angenommen; nur das lokale Entfernen
   * scheiterte (`acceptedButStuck` in `use-offline-queue.ts`).
   */
  readonly acceptedButStuck?: boolean;
}

/**
 * Was die Warteschlangenansicht zu einem Kommando sagt -- und ob sie das
 * Verwerfen anbieten darf. Diese Entscheidung gehoert hierher und nicht in
 * die Komponenten: sie haengt am einzelnen Eintrag, nicht am Scope.
 *
 * Ein angenommener, nur lokal haengender Eintrag bekommt einen eigenen Text
 * und `DISCARD`. Er ist der einzige wartende Eintrag, der verworfen werden
 * darf, und die Meldung sagt, warum das nichts kostet: der Server kennt ihn
 * bereits, verworfen wird nur die lokale Kopie. Vorher bot das
 * Warteschlangen-Band das Verwerfen fuer JEDEN wartenden Eintrag an, sobald
 * irgendein Schreibfehler des Scopes anstand -- ein Klick loeschte damit auch
 * eine dahinterstehende, von Hand erfasste und nie gesendete Aufnahme
 * endgueltig (Runde 7).
 */
export function queuedCommandNotice(command: OfflineCommand, view: QueuedCommandView): QueuedCommandNotice {
  switch (command.status) {
    case "CONFLICT":
      return { text: `${command.label} · ${command.error ?? "Konflikt mit dem Serverstand"}`, action: "DISCARD" };
    case "REJECTED":
      return { text: `${command.label} · Vom Server abgelehnt: ${command.error ?? "unbekannter Grund"}`, action: "DISCARD" };
    case "PENDING":
      if (view.acceptedButStuck === true) {
        return {
          text: `${command.label} · Vom Server angenommen; nur lokal nicht entfernt. Verwerfen räumt den Eintrag hier auf, am Serverstand ändert sich nichts.`,
          action: "DISCARD",
        };
      }
      return {
        text: `${command.label} · ${view.online ? view.pendingOnline ?? "Wiederholung läuft" : "Offline"}`,
        action: "RETRY",
      };
  }
}
