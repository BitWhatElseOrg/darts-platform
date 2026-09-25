// @vitest-environment happy-dom
//
// Befund 8 des Probelaufs vom 25.09.2026: Die Kommandozentrale nannte nach
// Turnierende die Siegerin nirgends.
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { TournamentDashboard } from "@darts-platform/schemas";

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
    generatedAt: new Date("2026-09-25T13:55:00.000Z"),
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
});
