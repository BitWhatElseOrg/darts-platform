// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { TournamentDashboard } from "@darts-platform/schemas";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { TournamentStandingsArea } from "./tournament-standings-area";

afterEach(cleanup);

// Nur die Felder, die der Wertungsbereich liest; der Rest des Dashboards
// spielt hier keine Rolle.
function dashboardOf(format: TournamentDashboard["tournament"]["format"]): TournamentDashboard {
  return {
    tournament: { format, status: "GROUP_STAGE" },
    groups: [],
    participants: [],
    clubDuel: null,
  } as unknown as TournamentDashboard;
}

describe("TournamentStandingsArea", () => {
  it("zeigt bei Vereinsduell ohne Projektion einen sichtbaren Hinweis statt der klassischen Rangliste", () => {
    render(createElement(TournamentStandingsArea, { dashboard: dashboardOf("CLUB_DUEL") }));
    expect(screen.getByRole("heading", { name: "Vereinsduell" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Vereinsduell-Ansicht derzeit nicht verfügbar.");
    expect(screen.queryByRole("heading", { name: "Gruppenstand" })).toBeNull();
  });

  it("zeigt bei klassischen Formaten die Rangliste ohne Hinweis", () => {
    render(createElement(TournamentStandingsArea, { dashboard: dashboardOf("GROUPS_THEN_KNOCKOUT") }));
    expect(screen.getByRole("heading", { name: "Gruppenstand" })).toBeTruthy();
    expect(screen.queryByText("Vereinsduell-Ansicht derzeit nicht verfügbar.")).toBeNull();
  });
});
