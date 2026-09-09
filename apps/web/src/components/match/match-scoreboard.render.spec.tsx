// @vitest-environment happy-dom
//
// Haelt die `.sektorenring`-Klasse auf der Scoreboard-Flaeche fest: sie ist
// keine Kosmetik, sondern der Schalter, der die Tailwind-Token (`sisal-*`,
// `chalk`, `ring-green`, `ring-red`, …) im Scoreboard auf ihre dunklen Werte
// umlegt (globals.css). Ginge sie in einem Refactor verloren, faellt die
// ganze Flaeche stillschweigend auf die helle `:root`-Palette zurueck --
// ein Regressionstest fehlte dafuer bislang (Backlog PR #37).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MatchStateResponse } from "@darts-platform/schemas";

import { MatchScoreboard } from "./match-scoreboard";

const queue = vi.hoisted(() => ({
  listOfflineCommands: vi.fn().mockResolvedValue([]),
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
const playerOneId = "33333333-3333-4333-8333-333333333333";
const playerTwoId = "44444444-4444-4444-8444-444444444444";

/** Ein einfaches, laufendes 501-Einzel ohne Aufnahmen. */
const match = {
  id: "22222222-2222-4222-8222-222222222222",
  organizationId,
  boardId: null,
  boardName: null,
  status: "IN_PROGRESS",
  version: 1,
  startingScore: 501,
  inRule: "STRAIGHT",
  outRule: "DOUBLE",
  bullOffFromLegOne: false,
  legStartPending: false,
  roundLimitReached: false,
  bestOfLegs: 5,
  legsToWin: 3,
  bestOfSets: 1,
  setsToWin: 1,
  currentSetNumber: 1,
  currentLegNumber: 1,
  currentLegVersion: 0,
  currentPlayerId: playerOneId,
  winnerPlayerId: null,
  participants: [
    {
      seat: 1,
      playerId: playerOneId,
      displayName: "Alex Muster",
      remaining: 501,
      legsWon: 0,
      legsWonInSet: 0,
      setsWon: 0,
      isActive: true,
      openedInLeg: true,
      players: [{ playerId: playerOneId, displayName: "Alex Muster", isThrowing: true }],
    },
    {
      seat: 2,
      playerId: playerTwoId,
      displayName: "Jordan Beispiel",
      remaining: 501,
      legsWon: 0,
      legsWonInSet: 0,
      setsWon: 0,
      isActive: false,
      openedInLeg: true,
      players: [{ playerId: playerTwoId, displayName: "Jordan Beispiel", isThrowing: false }],
    },
  ],
  visits: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  liveTarget: null,
} as unknown as MatchStateResponse;

function renderScoreboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MatchScoreboard
        backHref="/matches"
        backLabel="Zurück"
        canAbort={false}
        canScore={false}
        match={match}
        organizationId={organizationId}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("MatchScoreboard", () => {
  it("traegt die sektorenring-Klasse auf der Wurzelflaeche", () => {
    renderScoreboard();
    const root = screen.getByLabelText("Match-Scoreboard");
    expect(root.className).toContain("sektorenring");
  });
});
