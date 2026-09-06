"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  listOfflineCommands,
  markOfflineCommandConflict,
  markOfflineCommandRejected,
  removeOfflineCommand,
  removeOfflineCommandsForScope,
  saveOfflineCommand,
  type OfflineCommand,
} from "./offline-command-queue";
import {
  localCleanupFailureMessage,
  queueReadFailureMessage,
  queueSaveFailureMessage,
  queueUpdateFailureMessage,
  type ReplayFailure,
} from "./offline-replay";

/**
 * Ein Serverurteil, das in den Warteschlangeneintrag geschrieben wird.
 * `RETRY` gehoert nicht dazu: dabei bleibt der Eintrag unveraendert `PENDING`
 * und es wird gar nicht geschrieben.
 */
export type QueueOutcomeFailure = Extract<ReplayFailure, { readonly kind: "CONFLICT" | "REJECTED" }>;

export interface OfflineQueue {
  /** Der zuletzt erfolgreich gelesene Stand der Warteschlange. */
  readonly queued: readonly OfflineCommand[];
  /**
   * Meldung eines gescheiterten LESENS. Wird ausschliesslich vom Lesen
   * gesetzt und geloescht -- ein erfolgreiches Lesen beweist, dass die
   * Warteschlange lesbar ist, und nur das.
   */
  readonly readError: string | null;
  /**
   * Meldung eines gescheiterten SCHREIBENS (ablegen, markieren, entfernen).
   * Ueberlebt jedes Lesen: ein erfolgreiches Lesen beweist nicht, dass die
   * beabsichtigte Aenderung angekommen ist. Geloescht wird sie nur vom
   * naechsten erfolgreichen Schreiben.
   */
  readonly writeError: string | null;
  /** Liest die Warteschlange, ohne `queued` zu setzen. `null` heisst: Lesen gescheitert. */
  readonly readQueue: () => Promise<readonly OfflineCommand[] | null>;
  /** Liest die Warteschlange und uebernimmt sie in `queued`. Wirft nie. */
  readonly refreshQueue: () => Promise<void>;
  /** Legt ein Kommando ab. `false` heisst: nicht gespeichert, Meldung steht in `writeError`. */
  readonly persist: (command: OfflineCommand) => Promise<boolean>;
  /** Schreibt ein Serverurteil in den Eintrag. `false` heisst: nicht geschrieben. */
  readonly markOutcome: (command: OfflineCommand, failure: QueueOutcomeFailure) => Promise<boolean>;
  /** Entfernt einen Eintrag auf Wunsch der Person. `false` heisst: er steht unveraendert weiter da. */
  readonly remove: (commandId: string) => Promise<boolean>;
  /**
   * Entfernt einen Eintrag, den der Server bereits ANGENOMMEN hat. Eigene
   * Meldung: hier ist nichts fehlgeschlagen ausser dem lokalen Aufraeumen,
   * und das darf nicht wie ein Uebertragungsfehler aussehen
   * (`localCleanupFailureMessage`, PR-Agent-Befund F2).
   */
  readonly removeAccepted: (commandId: string) => Promise<boolean>;
  /** Leert die ganze Warteschlange dieses Scopes (z. B. nach einem Matchabbruch). */
  readonly clearScope: () => Promise<boolean>;
}

/**
 * Die lokale Offline-Warteschlange eines Scopes als Hook.
 *
 * Kommandozentrale und Scoringflaeche hielten diesen Zustand bis Runde 6
 * wortgleich doppelt -- `queued`, den initialen Read, `refreshQueue` und einen
 * gemeinsamen `queueError`. Jede Runde des PR-Agents fand dieselbe
 * Fehlerklasse deshalb zweimal, und jede Reparatur musste zweimal gemacht
 * werden (einmal wurde sie es nicht).
 *
 * Der Kern des Umbaus sind die ZWEI getrennten Fehlerzustaende. Vorher
 * schrieben Lesen und Schreiben in denselben `queueError`, und weil nach fast
 * jedem Schreiben ein `refreshQueue()` folgt, loeschte ein erfolgreiches Lesen
 * die Meldung eines gescheiterten Schreibens im selben Tick wieder -- die
 * Person sah nie, dass ihre Aenderung nicht angekommen war (Re-Review,
 * "Wipe-Bug"). Ein erfolgreiches Lesen sagt nur etwas ueber das Lesen aus.
 *
 * Alle Schreibgriffe geben `boolean` zurueck statt zu werfen: die
 * Aufruferinnen sollen den Fehlerfall behandeln muessen, nicht koennen.
 */
export function useOfflineQueue(scope: string): OfflineQueue {
  const [queued, setQueued] = useState<readonly OfflineCommand[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  // Kein `setState` mehr, nachdem die Flaeche verlassen wurde: IndexedDB und
  // Netz laufen laenger als die Ansicht.
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const readQueue = useCallback(async (): Promise<readonly OfflineCommand[] | null> => {
    try {
      const commands = await listOfflineCommands(scope);
      if (active.current) setReadError(null);
      return commands;
    } catch (error) {
      if (active.current) setReadError(queueReadFailureMessage(error));
      return null;
    }
  }, [scope]);

  const refreshQueue = useCallback(async (): Promise<void> => {
    const commands = await readQueue();
    if (commands !== null && active.current) setQueued(commands);
  }, [readQueue]);

  /**
   * Ein Schreibgriff mit eigener Meldung. `writeError` wird bei Erfolg
   * geloescht und bei Misserfolg gesetzt -- nie vom Lesen.
   */
  const write = useCallback(
    async (change: () => Promise<void>, failureMessage: (error: unknown) => string): Promise<boolean> => {
      try {
        await change();
      } catch (error) {
        if (active.current) setWriteError(failureMessage(error));
        return false;
      }
      if (active.current) setWriteError(null);
      return true;
    },
    [],
  );

  const persist = useCallback(
    (command: OfflineCommand) => write(() => saveOfflineCommand(command), queueSaveFailureMessage),
    [write],
  );

  const markOutcome = useCallback(
    (command: OfflineCommand, failure: QueueOutcomeFailure) =>
      write(
        () =>
          failure.kind === "CONFLICT"
            ? markOfflineCommandConflict(command, failure.code, failure.message)
            : markOfflineCommandRejected(command, failure.code, failure.message),
        queueUpdateFailureMessage,
      ),
    [write],
  );

  const remove = useCallback(
    (commandId: string) => write(() => removeOfflineCommand(commandId), queueUpdateFailureMessage),
    [write],
  );

  const removeAccepted = useCallback(
    (commandId: string) => write(() => removeOfflineCommand(commandId), localCleanupFailureMessage),
    [write],
  );

  const clearScope = useCallback(async (): Promise<boolean> => {
    const cleared = await write(async () => { await removeOfflineCommandsForScope(scope); }, queueUpdateFailureMessage);
    if (cleared && active.current) setQueued([]);
    return cleared;
  }, [scope, write]);

  // Die Warteschlange liegt in IndexedDB und wird beim Betreten der Flaeche
  // gelesen: ein offline erfasstes Kommando ueberlebt damit ein Neuladen.
  //
  // Der Fehlerzweig ist Pflicht: ohne ihn entstand bei nicht verfuegbarer oder
  // blockierter IndexedDB eine unbehandelte Rejection, und die Flaeche zeigte
  // eine leere Warteschlange -- die Person hielt sie fuer leer, obwohl
  // wartende Kommandos darin standen (AGENTS.md §18, PR-Agent-Runde 5).
  useEffect(() => {
    let current = true;
    void listOfflineCommands(scope).then(
      (commands) => { if (current && active.current) { setQueued(commands); setReadError(null); } },
      (error: unknown) => { if (current && active.current) setReadError(queueReadFailureMessage(error)); },
    );
    return () => { current = false; };
  }, [scope]);

  return { queued, readError, writeError, readQueue, refreshQueue, persist, markOutcome, remove, removeAccepted, clearScope };
}
