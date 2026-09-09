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
  legsToWin: 3,
  setsToWin: 1,
  visits: [],
  participants: [
    {
      playerId: "11111111-1111-4111-8111-111111111111",
      isActive: true,
      remaining: 341,
      legsWonInSet: 1,
      setsWon: 0,
      players: [{ playerId: "11111111-1111-4111-8111-111111111111", displayName: "Alex Muster", isThrowing: true }],
    },
    {
      playerId: "22222222-2222-4222-8222-222222222222",
      isActive: false,
      remaining: 501,
      legsWonInSet: 0,
      setsWon: 0,
      players: [{ playerId: "22222222-2222-4222-8222-222222222222", displayName: "Jordan Beispiel", isThrowing: false }],
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
});
