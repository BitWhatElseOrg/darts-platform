import { describe, expect, it } from "vitest";

import { tournamentDeletionBlocker } from "./tournament-deletion";

// Spec 2026-09-25-lease-karenz-turnier-loeschen (Befund 7): loeschbar ist nur
// ein Turnier, in dem nichts gespielt wurde. Der Server entscheidet; die
// Flaeche nennt den Grund schon vorher, damit der Knopf nicht ins Leere geht.
const free = { state: "FREE" as const };
const playing = { state: "PLAYING" as const };

describe("tournamentDeletionBlocker", () => {
  it("laesst ein Turnier ohne Ergebnisse und ohne laufendes Match loeschen", () => {
    expect(tournamentDeletionBlocker({ recentResults: [], boards: [free, free] })).toBeNull();
  });

  it("nennt ein laufendes Match als Grund", () => {
    expect(tournamentDeletionBlocker({ recentResults: [], boards: [free, playing] })).toBe(
      "Auf einem Board läuft noch ein Match.",
    );
  });

  it("nennt gespielte Matches als Grund", () => {
    expect(tournamentDeletionBlocker({ recentResults: [{ matchId: "x" }], boards: [free] })).toBe(
      "Es liegen bereits Ergebnisse vor. Ein gespieltes Turnier bleibt erhalten.",
    );
  });
});
