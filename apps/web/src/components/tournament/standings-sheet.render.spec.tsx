// @vitest-environment happy-dom
//
// Nebenbeobachtung aus der Sichtprobe vom 25.09.2026: bei Jeder gegen jeden
// stand "Gruppenstand · 0 Gruppen" -- das Format hat keine Gruppen, aber sehr
// wohl eine Tabelle, und die heisst nicht "Gruppe Jeder gegen jeden".
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { GroupStanding } from "@darts-platform/schemas";

import { StandingsSheet } from "./standings-sheet";

const row = { position: 1, playerId: "11111111-1111-4111-8111-111111111111", displayName: "Reto Ammann", played: 1, won: 1, lost: 0, legsFor: 2, legsAgainst: 0, legDifference: 2, points: 2, withdrawn: false, qualified: false };
const table = (groupLabel: string, qualifyCount: number): GroupStanding => ({ groupLabel, qualifyCount, playedMatches: 1, totalMatches: 6, rows: [row] });

afterEach(() => {
  cleanup();
});

describe("StandingsSheet", () => {
  it("nennt Gruppen bei Gruppen -> KO wie bisher", () => {
    render(createElement(StandingsSheet, { format: "GROUPS_THEN_KNOCKOUT", groups: [table("A", 2), table("B", 2)] }));
    expect(screen.getByRole("heading", { level: 2, name: "Gruppenstand" })).toBeTruthy();
    expect(screen.getByText("2 Gruppen")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Gruppe A" })).toBeTruthy();
  });

  it("zeigt bei Jeder gegen jeden eine Tabelle statt Gruppen", () => {
    render(createElement(StandingsSheet, { format: "ROUND_ROBIN", groups: [table("Jeder gegen jeden", 0)] }));
    expect(screen.getByRole("heading", { level: 2, name: "Tabelle" })).toBeTruthy();
    expect(screen.queryByText(/Gruppen$/u)).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Jeder gegen jeden" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3, name: /^Gruppe / })).toBeNull();
  });
});
