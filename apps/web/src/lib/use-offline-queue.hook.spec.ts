// @vitest-environment happy-dom
//
// Die schnelle Suite in `src` laeuft in der Node-Umgebung. Hooks brauchen ein
// DOM; die Pragma-Zeile oben stellt es genau fuer diese Datei bereit, ohne die
// uebrigen Tests zu verlangsamen. Konvention fuer weitere Hook-Tests:
// `*.hook.spec.ts` mit derselben Zeile.
//
// IndexedDB wird NICHT echt betrieben: die Warteschlangenfunktionen sind
// gestubbt. Getestet wird der Zustandsautomat des Hooks -- welcher Fehler
// welchen Zustand setzt und loescht --, und genau der war die Luecke, die
// fuenf PR-Agent-Runden nicht sehen konnten.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OfflineCommand } from "./offline-command-queue";
import { localCleanupFailureMessage, queueReadFailureMessage, queueUpdateFailureMessage } from "./offline-replay";
import { useOfflineQueue } from "./use-offline-queue";

const store = vi.hoisted(() => ({
  listOfflineCommands: vi.fn(),
  saveOfflineCommand: vi.fn(),
  removeOfflineCommand: vi.fn(),
  removeOfflineCommandsForScope: vi.fn(),
  markOfflineCommandConflict: vi.fn(),
  markOfflineCommandRejected: vi.fn(),
}));

vi.mock("./offline-command-queue", () => store);

const SCOPE = "tournament:org-1:turnier-1";

function command(overrides: Partial<OfflineCommand> = {}): OfflineCommand {
  return {
    commandId: "kommando-1",
    scope: SCOPE,
    path: "/organizations/org-1/tournaments/turnier-1/assignments",
    body: { commandId: "kommando-1" },
    label: "Zuweisung auf Board 1",
    createdAt: "2026-09-06T10:00:00.000Z",
    status: "PENDING",
    error: null,
    ...overrides,
  };
}

/** Mountet den Hook und wartet den initialen Read ab. */
async function mounted(initial: readonly OfflineCommand[] = []) {
  store.listOfflineCommands.mockResolvedValueOnce(initial);
  const view = renderHook(() => useOfflineQueue(SCOPE));
  await waitFor(() => { expect(view.result.current.queued).toEqual(initial); });
  return view;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useOfflineQueue", () => {
  it("laesst einen Schreibfehler ein nachfolgendes erfolgreiches Lesen ueberleben", async () => {
    // Der Wipe-Bug: `markOutcome` scheitert, unmittelbar danach laeuft
    // unbedingt `refreshQueue()`. Mit einem gemeinsamen `queueError` loeschte
    // das erfolgreiche Lesen die Meldung im selben Tick wieder, und die Person
    // sah nie, dass ihre Aenderung nicht angekommen war.
    const view = await mounted();
    const failure = new Error("IndexedDB ist blockiert.");
    store.markOfflineCommandConflict.mockRejectedValueOnce(failure);

    let written = true;
    await act(async () => {
      written = await view.result.current.markOutcome(command(), {
        kind: "CONFLICT",
        code: "TOURNAMENT_VERSION_CONFLICT",
        message: "Der Turnierzustand hat sich geändert.",
      });
    });

    expect(written).toBe(false);
    expect(view.result.current.writeError).toBe(queueUpdateFailureMessage(failure));

    const entries = [command()];
    store.listOfflineCommands.mockResolvedValueOnce(entries);
    await act(async () => { await view.result.current.refreshQueue(); });

    expect(view.result.current.queued).toEqual(entries);
    expect(view.result.current.readError).toBeNull();
    expect(view.result.current.writeError).toBe(queueUpdateFailureMessage(failure));
  });

  it("zeigt einen Lesefehler und loescht ihn beim naechsten erfolgreichen Lesen", async () => {
    const view = await mounted();
    const failure = new Error("Offline-Speicher ist nicht verfügbar.");
    store.listOfflineCommands.mockRejectedValueOnce(failure);

    await act(async () => { await view.result.current.refreshQueue(); });

    expect(view.result.current.readError).toBe(queueReadFailureMessage(failure));
    // Der zuletzt gelesene Stand bleibt stehen, statt zu einer leeren Liste zu
    // werden: eine leere Liste waere die gefaehrlichste aller Anzeigen.
    expect(view.result.current.queued).toEqual([]);

    const entries = [command()];
    store.listOfflineCommands.mockResolvedValueOnce(entries);
    await act(async () => { await view.result.current.refreshQueue(); });

    expect(view.result.current.readError).toBeNull();
    expect(view.result.current.queued).toEqual(entries);
  });

  it("meldet ein gescheitertes Entfernen nach Serverannahme, statt still zu enden", async () => {
    // Der Fall aus `use-match-scoring.ts`: der Server hat das Kommando
    // angenommen, nur das lokale Aufraeumen scheitert. Vorher ein leerer
    // `catch` -- der Eintrag blieb `PENDING` und sperrte die Scoringflaeche
    // ohne jede Erklaerung.
    const view = await mounted([command()]);
    const failure = new Error("IndexedDB ist blockiert.");
    store.removeOfflineCommand.mockRejectedValueOnce(failure);

    let removed = true;
    await act(async () => { removed = await view.result.current.removeAccepted("kommando-1"); });

    expect(removed).toBe(false);
    // Eigene Meldung: nicht "Uebertragung fehlgeschlagen", sondern "der Server
    // hat angenommen, das lokale Aufraeumen nicht".
    expect(view.result.current.writeError).toBe(localCleanupFailureMessage(failure));
    expect(view.result.current.readError).toBeNull();
  });

  it("loescht den Schreibfehler erst beim naechsten erfolgreichen Schreiben", async () => {
    const view = await mounted();
    store.saveOfflineCommand.mockRejectedValueOnce(new Error("Quota überschritten."));
    await act(async () => { await view.result.current.persist(command()); });
    expect(view.result.current.writeError).not.toBeNull();

    store.saveOfflineCommand.mockResolvedValueOnce(undefined);
    let written = false;
    await act(async () => { written = await view.result.current.persist(command()); });

    expect(written).toBe(true);
    expect(view.result.current.writeError).toBeNull();
  });
});
