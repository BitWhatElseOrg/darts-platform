// @vitest-environment happy-dom
//
// Befund 8 des Probelaufs vom 25.09.2026: Nach Turnierende sagte jede freie
// Kachel "Die Warteschlange wartet auf Ergebnisse oder eine offene Phase" --
// es gab aber nichts mehr, worauf sie warten konnte.
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { BoardSlot } from "@darts-platform/schemas";

import { BoardWedge } from "./board-wedge";

const freeSlot: BoardSlot = {
  boardId: "11111111-1111-4111-8111-111111111111",
  boardName: "Halle Board 1",
  ringNumber: 1,
  state: "FREE",
  blockedReason: null,
  match: null,
};

function renderWedge(tournamentStatus: "KNOCKOUT" | "COMPLETED"): void {
  render(
    createElement(BoardWedge, {
      disabled: false,
      justLanded: false,
      nextUp: null,
      now: new Date("2026-09-25T12:00:00.000Z"),
      onAssign: () => undefined,
      onRelease: () => undefined,
      pending: false,
      shortcut: "1",
      slot: freeSlot,
      tournamentStatus,
    }),
  );
}

afterEach(() => {
  cleanup();
});

describe("BoardWedge", () => {
  it("wartet waehrend des Turniers auf die naechste Paarung", () => {
    renderWedge("KNOCKOUT");
    expect(screen.getByText("Kein Match ist startbereit.")).toBeTruthy();
  });

  it("sagt nach Turnierende, dass nichts mehr kommt", () => {
    renderWedge("COMPLETED");
    expect(screen.getByText("Turnier beendet.")).toBeTruthy();
    expect(screen.queryByText(/wartet auf Ergebnisse/u)).toBeNull();
  });
});
