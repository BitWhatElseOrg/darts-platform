// @vitest-environment happy-dom
//
// Haelt die Oche-Regel (DESIGN.md, "The Oche Rule") fest: die aktive Seite
// zeigt ihren Reststand in `display` (3.5rem), die inaktive in `lead` (2rem)
// -- der Groessenunterschied ist der Zugindikator und darf nie verschwinden.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { MatchStateResponse } from "@darts-platform/schemas";

import { ScoreboardSides } from "./scoreboard-sides";

/** Nur die Felder, die die Komponente liest. */
const match = {
  status: "IN_PROGRESS",
  currentLegNumber: 1,
  bestOfLegs: 5,
  legsToWin: 3,
  bestOfSets: 1,
  setsToWin: 1,
  visits: [],
  participants: [
    {
      playerId: "11111111-1111-4111-8111-111111111111",
      isActive: true,
      remaining: 341,
      legsWon: 1,
      legsWonInSet: 1,
      setsWon: 0,
      players: [{ playerId: "11111111-1111-4111-8111-111111111111", displayName: "Alex Muster", isThrowing: true, clubLabel: null }],
    },
    {
      playerId: "22222222-2222-4222-8222-222222222222",
      isActive: false,
      remaining: 501,
      legsWon: 0,
      legsWonInSet: 0,
      setsWon: 0,
      players: [{ playerId: "22222222-2222-4222-8222-222222222222", displayName: "Jordan Beispiel", isThrowing: false, clubLabel: null }],
    },
  ],
} as unknown as MatchStateResponse;

afterEach(() => {
  cleanup();
});

describe("ScoreboardSides", () => {
  it("zeigt die aktive Seite im Display-Schritt und die inaktive im Lead-Schritt", () => {
    render(<ScoreboardSides match={match} pendingDarts={[]} showDartBand={false} />);
    const active = screen.getByLabelText("Alex Muster, Restscore");
    const inactive = screen.getByLabelText("Jordan Beispiel, Restscore");
    expect(active.className).toContain("text-display");
    expect(inactive.className).toContain("text-data");
    expect(inactive.className).not.toContain("text-display");
  });

  /**
   * Der Modus liegt allein in `bestOfSets` (Domaene, `matchModeOf`): genau ein
   * Satz heisst Matchplay. Dort gibt es keine Saetze zu gewinnen, und ein
   * „0 / 1 Sets" neben dem Legstand ist keine Angabe, sondern eine Zahl, die
   * sich nie bewegt -- sie steht in der Zeile, die auf dem Telefon den
   * eigentlichen Spielstand traegt.
   */
  it("nennt im Matchplay-Modus nur die Legs", () => {
    render(<ScoreboardSides match={match} pendingDarts={[]} showDartBand={false} />);
    expect(screen.getByText("1 / 3 Legs")).toBeTruthy();
    expect(screen.queryByText(/Sets/u)).toBeNull();
  });

  it("nennt im Set-Modus weiterhin Legs und Saetze", () => {
    const sets = { ...match, bestOfSets: 3, setsToWin: 2 } as unknown as MatchStateResponse;
    render(<ScoreboardSides match={sets} pendingDarts={[]} showDartBand={false} />);
    expect(screen.getByText("1 / 3 Legs · 0 / 2 Sets")).toBeTruthy();
  });

  /**
   * Nach dem Matchende steht `legsWonInSet` auf dem naechsten, nie begonnenen
   * Satz; im Set-Modus zaehlen dann nur noch die Saetze. Im Matchplay-Modus
   * gibt es keine, deshalb traegt die Zeile dort den Gesamt-Legstand
   * (`legsWon`) -- sonst stuende am Ende „0 / 3 Legs" unter der Siegerin.
   */
  it("haelt im beendeten Matchplay den Legstand fest", () => {
    const done = { ...match, status: "COMPLETED" } as unknown as MatchStateResponse;
    render(<ScoreboardSides match={done} pendingDarts={[]} showDartBand={false} />);
    expect(screen.getByText("1 / 3 Legs")).toBeTruthy();
    expect(screen.queryByText(/Sets/u)).toBeNull();
  });

  /**
   * Im Vereinsduell steht das Vereinskuerzel neben dem Namen, nie an seiner
   * Stelle. Der Matchzustand kennt nur das Kuerzel, deshalb benennt ein
   * Screenreader-Praefix es als Verein; der `title` des Namens traegt es mit.
   */
  it("zeigt im Vereinsduell das Vereinskuerzel neben jedem Namen", () => {
    const [home, away] = match.participants;
    const duel = {
      ...match,
      participants: [
        { ...home, players: [{ ...home.players[0], clubLabel: "VFC" }] },
        { ...away, players: [{ ...away.players[0], clubLabel: "DM" }] },
      ],
    } as unknown as MatchStateResponse;
    render(<ScoreboardSides match={duel} pendingDarts={[]} showDartBand={false} />);
    expect(screen.getByText("VFC")).toBeTruthy();
    expect(screen.getByText("DM")).toBeTruthy();
    expect(screen.getByTitle("Alex Muster (VFC)").textContent).toContain("Alex Muster Verein VFC");
    expect(screen.getByTitle("Jordan Beispiel (DM)").textContent).toContain("Jordan Beispiel Verein DM");
  });

  it("zeigt ohne Verein kein Kuerzel", () => {
    render(<ScoreboardSides match={match} pendingDarts={[]} showDartBand={false} />);
    expect(screen.queryByText(/Verein/u)).toBeNull();
    expect(screen.getByTitle("Alex Muster")).toBeTruthy();
  });
});
