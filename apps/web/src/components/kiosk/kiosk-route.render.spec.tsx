// @vitest-environment happy-dom
//
// Kiosk `/scheibe` (Spec 2026-09-30-scheiben-tablet, Task 11). Muster:
// `board-devices-section.render.spec.tsx` -- `apiRequest` gemockt, keine
// echte Netzwerkschicht. `MatchScoreboard` ist eine eigene, ausfuehrlich
// getestete Flaeche (`match-scoreboard.render.spec.tsx`); hier zaehlt nur,
// dass der Kiosk sie mit den richtigen Props aufruft -- deshalb eine
// Attrappe statt der echten Komponente.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-error";
import { KIOSK_POLL_MS } from "./kiosk-view";

const routerReplace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace }),
}));

const deviceKeyStorage = vi.hoisted(() => ({
  stored: null as { readonly secret: string; readonly boardName: string; readonly organizationName: string } | null,
  forgetBoardDevice: vi.fn(),
}));
vi.mock("@/lib/device-key-storage", () => ({
  // `getBoardDeviceSnapshot`/`subscribeBoardDeviceChanges` ersetzen das
  // fruehere `recallBoardDevice()` in `kiosk-route.tsx` (Task 12,
  // Hydration-Review-Fix) -- `deviceKeyStorage.stored` ist hier bereits eine
  // stabile Referenz (von `beforeEach`/den einzelnen Faellen gesetzt), die
  // Attrappe braucht also keinen eigenen Cache. `subscribeBoardDeviceChanges`
  // bleibt ein No-op: ReactDOMs `createRoot` (das diese Tests ueber
  // `@testing-library/react` verwenden) zieht `getServerSnapshot` nur beim
  // echten Hydrieren heran, ein Abonnement auf Aenderungen ist fuer die
  // Faelle hier nicht noetig.
  getBoardDeviceSnapshot: () => deviceKeyStorage.stored,
  subscribeBoardDeviceChanges: () => () => {},
  forgetBoardDevice: deviceKeyStorage.forgetBoardDevice,
}));

const offlineQueue = vi.hoisted(() => ({
  commands: [] as unknown[],
  calls: [] as string[],
}));
vi.mock("@/lib/offline-command-queue", () => ({
  listOfflineCommands: vi.fn((scope: string) => {
    offlineQueue.calls.push(scope);
    return Promise.resolve(offlineQueue.commands);
  }),
}));

const matchScoreboard = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));
vi.mock("@/components/match/match-scoreboard", () => ({
  MatchScoreboard: (props: Record<string, unknown>) => {
    matchScoreboard.calls.push(props);
    return createElement("div", { "data-testid": "match-scoreboard-stub" }, "Scoreboard-Attrappe");
  },
}));

const server = vi.hoisted(() => ({
  self: null as unknown,
  selfRejection: null as unknown,
  match: null as unknown,
  matchRejection: null as unknown,
}));

const client = vi.hoisted(() => ({
  apiRequest: vi.fn((input: { readonly path: string; readonly deviceSecret?: string }) => {
    if (input.path === "/board-devices/me") {
      if (server.selfRejection !== null) return Promise.reject(server.selfRejection);
      return Promise.resolve(server.self);
    }
    if (input.path.includes("/matches/")) {
      if (server.matchRejection !== null) return Promise.reject(server.matchRejection);
      return Promise.resolve(server.match);
    }
    return Promise.reject(new Error(`Unerwarteter Aufruf: ${input.path}`));
  }),
}));
vi.mock("@/lib/api-client", () => client);

import { KioskRoute } from "./kiosk-route";

const organizationId = "11111111-1111-4111-8111-111111111111";
const matchId = "22222222-2222-4222-8222-222222222222";
const deviceSecret = "bd_kiosk-secret";

const selfResponse = (currentMatchId: string | null) => ({
  device: { id: "55555555-5555-4555-8555-555555555555", label: "Tablet" },
  board: { id: "33333333-3333-4333-8333-333333333333", name: "Scheibe 1" },
  organization: { id: organizationId, name: "VFC Musterstadt" },
  currentMatchId,
});

const matchState = {
  id: matchId,
  organizationId,
  boardId: "33333333-3333-4333-8333-333333333333",
  boardName: "Scheibe 1",
  status: "IN_PROGRESS",
  version: 1,
  startingScore: 501,
  inRule: "STRAIGHT_IN",
  outRule: "DOUBLE_OUT",
  legStartRule: "BULL_FIRST_LEG",
  legStartPending: false,
  roundLimitReached: false,
  bestOfLegs: 1,
  legsToWin: 1,
  bestOfSets: 1,
  setsToWin: 1,
  currentSetNumber: 1,
  currentLegNumber: 1,
  currentLegVersion: 0,
  currentPlayerId: "44444444-4444-4444-8444-444444444444",
  winnerPlayerId: null,
  participants: [],
  visits: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  liveTarget: null,
};

function renderRoute() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(createElement(QueryClientProvider, { client: queryClient }, createElement(KioskRoute)));
  return { ...view, queryClient };
}

beforeEach(() => {
  deviceKeyStorage.stored = null;
  deviceKeyStorage.forgetBoardDevice.mockClear();
  routerReplace.mockClear();
  server.self = null;
  server.selfRejection = null;
  server.match = null;
  server.matchRejection = null;
  client.apiRequest.mockClear();
  matchScoreboard.calls = [];
  offlineQueue.commands = [];
  offlineQueue.calls = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("KioskRoute", () => {
  it("zeigt ohne gespeicherten Geraeteschluessel einen Hinweis mit Link zur Startseite", () => {
    deviceKeyStorage.stored = null;
    renderRoute();

    expect(screen.getByText("Dieses Tablet ist nicht gekoppelt.")).not.toBeNull();
    const link = screen.getByRole("link", { name: "Zur Startseite" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/");
    expect(client.apiRequest).not.toHaveBeenCalled();
  });

  it("zeigt den Leerlauf mit Scheiben- und Organisationsnamen ohne laufendes Match", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(null);
    renderRoute();

    await screen.findByText("Scheibe 1 – wartet auf nächstes Match");
    expect(screen.getByText("VFC Musterstadt")).not.toBeNull();
    expect(client.apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/board-devices/me", deviceSecret }),
    );
  });

  it("rendert die Scoringflaeche fuer das laufende Match der Scheibe", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.match = matchState;
    renderRoute();

    await screen.findByTestId("match-scoreboard-stub");
    const props = matchScoreboard.calls.at(-1)!;
    expect(props.canScore).toBe(true);
    expect(props.canAbort).toBe(false);
    expect(props.backHref).toBeUndefined();
    expect(props.showHeaderLinks).toBe(false);
    expect(props.organizationId).toBe(organizationId);
    expect((props.match as { readonly id: string }).id).toBe(matchId);

    expect(client.apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ path: `/organizations/${organizationId}/matches/${matchId}`, deviceSecret }),
    );
  });

  it("vergisst den Geraeteschluessel und meldet den Widerruf", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.selfRejection = new ApiClientError("Dieses Tablet ist nicht mehr gekoppelt.", "DEVICE_REVOKED", null, undefined, 401);
    renderRoute();

    await waitFor(() => {
      expect(deviceKeyStorage.forgetBoardDevice).toHaveBeenCalled();
    });
    expect(
      screen.getByText(
        "Dieses Tablet ist nicht mehr gekoppelt – bitte in der Organisationsverwaltung unter «Scheiben-Tablets» neu einrichten.",
      ),
    ).not.toBeNull();
  });

  // Task-Review-Befund CRITICAL 1: `/me` meldet weiterhin dasselbe Match,
  // dessen Lesepfad bereits 404 geliefert hat (der Server hat die Zuweisung
  // noch nicht aufgeloest). Ohne die Ablehnungs-Wache setzte die
  // Render-Anpassung `currentMatchId` aus der (unveraenderten) `/me`-Antwort
  // sofort wieder auf das abgelehnte Match zurueck, die Match-Query lehnte es
  // (aus dem Cache) erneut ab -- eine synchrone Render-Schleife ("Too many
  // re-renders"). `findByText` unten wuerde mit genau diesem Fehler
  // fehlschlagen, liefe die Schleife noch.
  it("faellt nach 404 in den Leerlauf zurueck, auch wenn /me weiter dasselbe Match meldet", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.matchRejection = new ApiClientError("Dieses Match gibt es nicht mehr.", "REQUEST_FAILED", null, undefined, 404);
    renderRoute();

    // Erst die Ladeanzeige abwarten -- sie erscheint nur, wenn `matchId`
    // tatsaechlich aktiv wurde und die (gleich abgelehnte) Match-Query
    // lief. Der Leerlauftext allein waere kein Beweis: er steht (mit dem
    // Namen aus `localStorage`) schon beim allerersten, noch leeren Render.
    await screen.findByText("Match wird geladen …");
    await waitFor(() => {
      expect(screen.queryByText("Match wird geladen …")).toBeNull();
    });
    expect(screen.getByText("Scheibe 1 – wartet auf nächstes Match")).not.toBeNull();
    expect(client.apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ path: `/organizations/${organizationId}/matches/${matchId}` }),
    );
  });

  // Task-Review-Befund IMPORTANT 2: `/me` meldet `currentMatchId: null`,
  // bevor die Match-Query den COMPLETED-Status gesehen hat. Der Kiosk muss
  // das zuletzt laufende Match noch einmal laden, statt sofort in den
  // Leerlauf zu springen -- sonst erscheint der Endstand nie.
  it("zeigt den Endstand, auch wenn /me das Match schon vor dem COMPLETED-Poll nicht mehr als aktuell meldet", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.match = matchState;
    const { queryClient } = renderRoute();

    await screen.findByTestId("match-scoreboard-stub");

    // Naechster Poll: `/me` kennt kein laufendes Match mehr, die Match-Query
    // sieht gleichzeitig den COMPLETED-Uebergang.
    server.self = selfResponse(null);
    server.match = { ...matchState, status: "COMPLETED" };
    await act(async () => {
      await queryClient.refetchQueries();
    });

    const weiterButton = await screen.findByRole("button", { name: "Weiter" });
    expect(screen.getByTestId("match-scoreboard-stub")).not.toBeNull();

    fireEvent.click(weiterButton);
    await screen.findByText("Scheibe 1 – wartet auf nächstes Match");
  });

  // Task-Review-Befund IMPORTANT 3: nach `DEVICE_REVOKED` darf weder die
  // Selbstauskunft noch die Match-Query weiter pollen.
  it("pollt nach DEVICE_REVOKED nicht weiter", async () => {
    // Faelschungszeit von Anfang an: ein bereits VOR der Umstellung auf
    // Fake-Timer geplanter echter `setTimeout` (der naechste Poll nach dem
    // ersten, erfolgreichen Abruf) bliebe sonst ein echter Timer und
    // reagierte nicht auf `advanceTimersByTimeAsync` -- die Zusicherung
    // unten wuerde nie eintreten, ohne dass das ein echter Regressionsbefund
    // waere.
    vi.useFakeTimers();
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.match = matchState;
    renderRoute();
    // Die gemockten Anfragen sind bereits aufgeloeste Promises; sie brauchen
    // keine echten Timer, nur durchlaufende Mikrotasks -- und zwar zwei
    // Wellen davon: erst loest sich die Selbstauskunft auf, was `matchId`
    // erst DANACH aktiviert; die Match-Query beginnt also eine Renderphase
    // spaeter. `advanceTimersByTimeAsync(0)` treibt je eine Welle an.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByTestId("match-scoreboard-stub")).not.toBeNull();

    server.selfRejection = new ApiClientError("Dieses Tablet ist nicht mehr gekoppelt.", "DEVICE_REVOKED", null, undefined, 401);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(KIOSK_POLL_MS);
    });
    expect(
      screen.getByText(
        "Dieses Tablet ist nicht mehr gekoppelt – bitte in der Organisationsverwaltung unter «Scheiben-Tablets» neu einrichten.",
      ),
    ).not.toBeNull();
    const callsAfterRevocation = client.apiRequest.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(KIOSK_POLL_MS * 5);
    });
    expect(client.apiRequest.mock.calls.length).toBe(callsAfterRevocation);
  });

  // Task-Review-Befund GAP 4: offene Warteschlangen-Eintraege eines
  // abgebrochenen Matches werden im Leerlauf sichtbar gemeldet, nicht still
  // verworfen -- und nicht geloescht.
  it("meldet im Leerlauf offene Aufnahmen eines abgebrochenen Matches", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = selfResponse(matchId);
    server.matchRejection = new ApiClientError("Dieses Match gibt es nicht mehr.", "REQUEST_FAILED", null, undefined, 404);
    offlineQueue.commands = [{ commandId: "a" }, { commandId: "b" }];
    renderRoute();

    await screen.findByText(
      "2 Aufnahmen des abgebrochenen Matches konnten nicht mehr übertragen werden.",
    );
    expect(offlineQueue.calls).toContain(`match:${organizationId}:${matchId}`);
  });
});
