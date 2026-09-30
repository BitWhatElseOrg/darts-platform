// @vitest-environment happy-dom
//
// Kiosk `/scheibe` (Spec 2026-09-30-scheiben-tablet, Task 11). Muster:
// `board-devices-section.render.spec.tsx` -- `apiRequest` gemockt, keine
// echte Netzwerkschicht. `MatchScoreboard` ist eine eigene, ausfuehrlich
// getestete Flaeche (`match-scoreboard.render.spec.tsx`); hier zaehlt nur,
// dass der Kiosk sie mit den richtigen Props aufruft -- deshalb eine
// Attrappe statt der echten Komponente.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-error";

const routerReplace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace }),
}));

const deviceKeyStorage = vi.hoisted(() => ({
  stored: null as { readonly secret: string; readonly boardName: string; readonly organizationName: string } | null,
  forgetBoardDevice: vi.fn(),
}));
vi.mock("@/lib/device-key-storage", () => ({
  recallBoardDevice: () => deviceKeyStorage.stored,
  forgetBoardDevice: deviceKeyStorage.forgetBoardDevice,
}));

vi.mock("@/lib/offline-command-queue", () => ({
  listOfflineCommands: vi.fn().mockResolvedValue([]),
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
}));

const client = vi.hoisted(() => ({
  apiRequest: vi.fn((input: { readonly path: string; readonly deviceSecret?: string }) => {
    if (input.path === "/board-devices/me") {
      if (server.selfRejection !== null) return Promise.reject(server.selfRejection);
      return Promise.resolve(server.self);
    }
    if (input.path.includes("/matches/")) {
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
  return render(createElement(QueryClientProvider, { client: queryClient }, createElement(KioskRoute)));
}

beforeEach(() => {
  deviceKeyStorage.stored = null;
  deviceKeyStorage.forgetBoardDevice.mockClear();
  routerReplace.mockClear();
  server.self = null;
  server.selfRejection = null;
  server.match = null;
  client.apiRequest.mockClear();
  matchScoreboard.calls = [];
});

afterEach(() => {
  cleanup();
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
    server.self = {
      device: { id: "55555555-5555-4555-8555-555555555555", label: "Tablet" },
      board: { id: "33333333-3333-4333-8333-333333333333", name: "Scheibe 1" },
      organization: { id: organizationId, name: "VFC Musterstadt" },
      currentMatchId: null,
    };
    renderRoute();

    await screen.findByText("Scheibe 1 – wartet auf nächstes Match");
    expect(screen.getByText("VFC Musterstadt")).not.toBeNull();
    expect(client.apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/board-devices/me", deviceSecret }),
    );
  });

  it("rendert die Scoringflaeche fuer das laufende Match der Scheibe", async () => {
    deviceKeyStorage.stored = { secret: deviceSecret, boardName: "Scheibe 1", organizationName: "VFC Musterstadt" };
    server.self = {
      device: { id: "55555555-5555-4555-8555-555555555555", label: "Tablet" },
      board: { id: "33333333-3333-4333-8333-333333333333", name: "Scheibe 1" },
      organization: { id: organizationId, name: "VFC Musterstadt" },
      currentMatchId: matchId,
    };
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
});
