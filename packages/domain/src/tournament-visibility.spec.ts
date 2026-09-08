import { describe, expect, it } from "vitest";

import { isTournamentVisibility, tournamentVisibilities } from "./tournament-visibility";

describe("tournamentVisibilities", () => {
  it("kennt genau zwei Stufen", () => {
    expect([...tournamentVisibilities]).toEqual(["PRIVATE", "PUBLIC"]);
  });

  it("erkennt gueltige Werte", () => {
    expect(isTournamentVisibility("PRIVATE")).toBe(true);
    expect(isTournamentVisibility("PUBLIC")).toBe(true);
  });

  it("weist alles andere ab", () => {
    expect(isTournamentVisibility("UNLISTED")).toBe(false);
    expect(isTournamentVisibility("public")).toBe(false);
    expect(isTournamentVisibility(undefined)).toBe(false);
  });
});
