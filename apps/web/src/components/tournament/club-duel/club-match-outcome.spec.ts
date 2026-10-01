import { describe, expect, it } from "vitest";

import { matchOutcomeText } from "./club-match-outcome";

const name = (playerId: string | null) => (playerId === "a" ? "Anna" : playerId === null ? "offen" : "?");

describe("matchOutcomeText", () => {
  it("nennt bei kampflosem Sieg den Sieger", () => {
    expect(matchOutcomeText({ legs: null, winnerPlayerId: "a" }, true, name)).toBe("kampflos · Sieg Anna");
  });

  it("zeigt bei kampflos ohne Sieger nur «kampflos»", () => {
    expect(matchOutcomeText({ legs: null, winnerPlayerId: null }, true, name)).toBe("kampflos");
  });

  it("zeigt bei gespielten Spielen die Legs", () => {
    expect(matchOutcomeText({ legs: [2, 1], winnerPlayerId: "a" }, false, name)).toBe("2:1");
  });
});
