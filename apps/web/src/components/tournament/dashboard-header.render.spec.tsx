// @vitest-environment happy-dom
//
// Befund 8 des Probelaufs vom 25.09.2026: Die Kommandozentrale nannte nach
// Turnierende die Siegerin nirgends.
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { ClubDuelDashboard, TournamentDashboard } from "@darts-platform/schemas";

import { DashboardHeader } from "./dashboard-header";

function dashboard(status: "KNOCKOUT" | "COMPLETED"): TournamentDashboard {
  return {
    tournament: {
      id: "11111111-1111-4111-8111-111111111111",
      publicId: "22222222-2222-4222-8222-222222222222",
      visibility: "PUBLIC",
      organizationId: "33333333-3333-4333-8333-333333333333",
      name: "Herbst-Cup",
      status,
      format: "GROUPS_THEN_KNOCKOUT",
      version: 61,
      stageLabel: status === "COMPLETED" ? "Turnier beendet" : "K.-o.-Runde",
      startingScore: 501,
      inRule: "STRAIGHT",
      outRule: "DOUBLE",
      playedMatches: status === "COMPLETED" ? 31 : 30,
      totalMatches: 31,
      startsAt: new Date("2026-09-25T12:00:00.000Z"),
    },
    participants: [],
    boards: [],
    queue: [],
    conflicts: [],
    groups: [],
    bracket: [
      { matchId: "44444444-4444-4444-8444-444444444444", stageLabel: "K.-o. · Runde 3", round: 3, position: 1, status: status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS", resultType: status === "COMPLETED" ? "PLAYED" : null, participantNames: ["Adrian Oberholzer", "Melanie Lüthi"], winnerDisplayName: status === "COMPLETED" ? "Melanie Lüthi" : null },
    ],
    recentResults: [],
    clubDuel: null,
    generatedAt: new Date("2026-09-25T13:55:00.000Z"),
  };
}

const playerA = "55555555-5555-4555-8555-555555555555";
const playerB = "66666666-6666-4666-8666-666666666666";

// Minimales Vereinsduell: zwei Spieler, das Final hat Seite B gewonnen.
function clubDuelBlock(finalStatus: "WAITING" | "COMPLETED"): ClubDuelDashboard {
  return {
    sideAName: "VFC",
    sideBName: "DC Musterdorf",
    qualifyingRounds: 1,
    finalRoundSize: 1,
    thirdPlaceMatch: false,
    currentRound: 1,
    rounds: [],
    standings: { overall: [], sideA: [], sideB: [] },
    finalRound: { sideA: [], sideB: [], matches: [] },
    finals: {
      final: {
        matchId: "77777777-7777-4777-8777-777777777777",
        position: 1,
        playerAId: playerA,
        playerBId: playerB,
        status: finalStatus,
        resultType: finalStatus === "COMPLETED" ? "PLAYED" : null,
        winnerPlayerId: finalStatus === "COMPLETED" ? playerB : null,
        legs: finalStatus === "COMPLETED" ? [1, 3] : null,
      },
      thirdPlace: null,
    },
    score: { pointsA: 1, pointsB: 1, legDifferenceA: 0, leader: "TIED" },
  };
}

function clubDuelDashboard(status: "GROUP_STAGE" | "COMPLETED"): TournamentDashboard {
  const base = dashboard("COMPLETED");
  return {
    ...base,
    tournament: { ...base.tournament, status, format: "CLUB_DUEL", stageLabel: status === "COMPLETED" ? "Turnier beendet" : "Runde 1" },
    participants: [
      { playerId: playerA, displayName: "Adrian Oberholzer", seed: 1, status: "ACTIVE", withdrawnAt: null, withdrawalReason: null, side: "A" },
      { playerId: playerB, displayName: "Melanie Lüthi", seed: 2, status: "ACTIVE", withdrawnAt: null, withdrawalReason: null, side: "B" },
    ],
    bracket: [],
    clubDuel: clubDuelBlock(status === "COMPLETED" ? "COMPLETED" : "WAITING"),
  };
}

afterEach(() => {
  cleanup();
});

describe("DashboardHeader", () => {
  it("nennt nach Turnierende den Turniersieg", () => {
    render(createElement(DashboardHeader, { connection: "live", dashboard: dashboard("COMPLETED"), pendingCount: 0 }));
    expect(screen.getByText(/Turniersieg: Melanie Lüthi/u)).toBeTruthy();
  });

  it("nennt waehrend des Turniers keinen Sieg", () => {
    render(createElement(DashboardHeader, { connection: "live", dashboard: dashboard("KNOCKOUT"), pendingCount: 0 }));
    expect(screen.queryByText(/Turniersieg/u)).toBeNull();
  });

  it("nennt im beendeten Vereinsduell den Finalsieger und den Zustand beendet", () => {
    render(createElement(DashboardHeader, { connection: "live", dashboard: clubDuelDashboard("COMPLETED"), pendingCount: 0 }));
    expect(screen.getByText(/Turniersieg: Melanie Lüthi/u)).toBeTruthy();
    expect(screen.getByText("beendet")).toBeTruthy();
  });

  it("nennt im laufenden Vereinsduell den Zustand Qualifikation und keinen Sieg", () => {
    render(createElement(DashboardHeader, { connection: "live", dashboard: clubDuelDashboard("GROUP_STAGE"), pendingCount: 0 }));
    expect(screen.getByText("Qualifikation")).toBeTruthy();
    expect(screen.queryByText(/Turniersieg/u)).toBeNull();
  });
});
