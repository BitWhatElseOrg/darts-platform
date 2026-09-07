// @vitest-environment happy-dom
//
// Konvention aus Tier 1: Hook-Tests heissen `*.hook.spec.*` und holen sich das
// DOM ueber die Pragma-Zeile (siehe `use-offline-queue.hook.spec.ts`).
//
// Geprueft wird die `navigator.onLine`-Wache der Scoringflaeche — bis hierher
// ungetestet (Audit-Nachtrag „Testschuld"): Sie entscheidet, ob eine Aufnahme
// an den Server geht oder in die lokale Warteschlange, und sie startet die
// Wiedergabe, sobald das Geraet zurueck im Netz ist. Faellt sie falsch aus,
// geht entweder eine Aufnahme verloren oder sie bleibt liegen, obwohl die
// Verbindung steht.
//
// IndexedDB laeuft nicht echt; die Warteschlangenfunktionen sind gestubbt.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MatchStateResponse } from "@darts-platform/schemas";

import { useMatchScoring } from "./use-match-scoring";

const queue = vi.hoisted(() => ({
  listOfflineCommands: vi.fn(),
  saveOfflineCommand: vi.fn(),
  removeOfflineCommand: vi.fn(),
  removeOfflineCommandsForScope: vi.fn(),
  markOfflineCommandConflict: vi.fn(),
  markOfflineCommandRejected: vi.fn(),
}));
vi.mock("@/lib/offline-command-queue", () => queue);

const client = vi.hoisted(() => ({ apiRequest: vi.fn(), userFacingErrorMessage: vi.fn(() => "Fehler") }));
vi.mock("@/lib/api-client", () => client);

vi.mock("@/lib/use-board-controller-lock", () => ({
  useBoardControllerLock: () => ({ controllerId: "controller-1", state: "EIGEN", takeOver: vi.fn() }),
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const matchId = "22222222-2222-4222-8222-222222222222";
const playerId = "33333333-3333-4333-8333-333333333333";

/** Nur die Felder, die der Hook liest. */
const match = {
  id: matchId,
  organizationId,
  version: 7,
  status: "IN_PROGRESS",
  currentPlayerId: playerId,
  currentLegNumber: 1,
} as unknown as MatchStateResponse;

// Ohne JSX: die schnelle Suite uebersetzt `.ts`, nicht `.tsx`.
function wrapper({ children }: { readonly children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

/**
 * happy-dom meldet `navigator.onLine` fest als `true`; ohne diesen Spy laesst
 * sich der Offline-Fall gar nicht stellen. Der Spy wird EINMAL je Test
 * eingehaengt und liest danach diese Variable — ein zweiter `spyOn` auf
 * denselben Getter greift nicht mehr, und der Test glaubte dann, das Geraet
 * sei zurueck im Netz, waehrend der Hook weiterhin `false` las.
 */
let deviceOnline = true;

function setOnline(value: boolean): void {
  deviceOnline = value;
}

async function mounted() {
  const view = renderHook(() => useMatchScoring({ organizationId, match, canScore: true }), { wrapper });
  await waitFor(() => {
    expect(queue.listOfflineCommands).toHaveBeenCalled();
  });
  return view;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  deviceOnline = true;
  vi.spyOn(window.navigator, "onLine", "get").mockImplementation(() => deviceOnline);
  queue.listOfflineCommands.mockResolvedValue([]);
  queue.saveOfflineCommand.mockResolvedValue(undefined);
  queue.removeOfflineCommand.mockResolvedValue(undefined);
  client.apiRequest.mockResolvedValue({ ...match, version: 8 });
});

describe("navigator.onLine-Wache der Scoringflaeche", () => {
  it("sendet eine Aufnahme, solange das Geraet im Netz ist", async () => {
    setOnline(true);
    const view = await mounted();

    await act(async () => {
      view.result.current.submitVisit({ points: 60, dartsThrown: 3 });
    });

    await waitFor(() => {
      expect(client.apiRequest).toHaveBeenCalled();
    });
    expect(queue.saveOfflineCommand).not.toHaveBeenCalled();
  });

  it("legt sie offline in die Warteschlange, statt sie zu verlieren", async () => {
    setOnline(false);
    const view = await mounted();

    await act(async () => {
      view.result.current.submitVisit({ points: 60, dartsThrown: 3 });
    });

    await waitFor(() => {
      expect(queue.saveOfflineCommand).toHaveBeenCalledTimes(1);
    });
    expect(client.apiRequest).not.toHaveBeenCalled();
    const saved = queue.saveOfflineCommand.mock.calls[0]?.[0] as {
      readonly path: string;
      readonly body: { readonly expectedVersion: number; readonly points: number };
    };
    // Die gespeicherte Aufnahme traegt den Serverstand, auf dem sie fachlich
    // beruht -- die Wiedergabe verkettet daraus die Folgeversionen.
    expect(saved.path).toBe(`/organizations/${organizationId}/matches/${matchId}/visits`);
    expect(saved.body.expectedVersion).toBe(7);
    expect(saved.body.points).toBe(60);
  });

  it("meldet den Verbindungszustand und folgt den Ereignissen", async () => {
    setOnline(true);
    const view = await mounted();
    expect(view.result.current.online).toBe(true);

    await act(async () => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(view.result.current.online).toBe(false);

    await act(async () => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(view.result.current.online).toBe(true);
  });

  it("uebertraegt die Warteschlange, sobald das Geraet zurueck im Netz ist", async () => {
    setOnline(false);
    const pending = {
      commandId: "44444444-4444-4444-8444-444444444444",
      scope: `match:${organizationId}:${matchId}`,
      path: `/organizations/${organizationId}/matches/${matchId}/visits`,
      body: { commandId: "44444444-4444-4444-8444-444444444444", expectedVersion: 7 },
      label: "60 Punkte",
      createdAt: "2026-09-07T10:00:00.000Z",
      status: "PENDING" as const,
      error: null,
    };
    // Erst der Eintrag, danach leer: der Stub ahmt nach, dass der Eintrag
    // nach der Annahme durch den Server aus der Warteschlange verschwindet.
    // Bliebe er stehen, liefe die Wiedergabe endlos gegen dieselbe Aufnahme.
    let remaining: readonly (typeof pending)[] = [pending];
    queue.listOfflineCommands.mockImplementation(async () => remaining);
    queue.removeOfflineCommand.mockImplementation(async () => {
      remaining = [];
    });
    await mounted();

    // Offline passiert nichts -- die Wiedergabe kehrt sofort zurueck.
    expect(client.apiRequest).not.toHaveBeenCalled();

    await act(async () => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => {
      expect(client.apiRequest).toHaveBeenCalled();
    });
    // Auf die ANZAHL kommt es hier nicht an: wie oft die Wiedergabe im
    // gestubbten Umfeld anlaeuft, haengt daran, wie oft der Effekt neu
    // eingehaengt wird. Entscheidend ist, dass sie ueberhaupt erst nach dem
    // `online`-Ereignis laeuft und dann genau die wartende Aufnahme sendet;
    // die `commandId` macht eine Wiederholung serverseitig folgenlos.
    expect(client.apiRequest.mock.calls[0]?.[0]).toMatchObject({
      path: pending.path,
      method: "POST",
      body: { commandId: pending.commandId },
    });
  });
});
