import { describe, expect, it } from "vitest";

import { sideNames, sideNamesWithClub } from "./side-names";

const single = { players: [{ displayName: "Anna Muster", clubLabel: "VFC" }] };
const pair = {
  players: [
    { displayName: "Anna Muster", clubLabel: "VFC" },
    { displayName: "Beat Beispiel", clubLabel: null },
  ],
};

describe("side-names", () => {
  it("verbindet mehrere Personen mit «und»", () => {
    expect(sideNames(pair)).toBe("Anna Muster und Beat Beispiel");
  });

  it("hängt im Vereinsduell das Kürzel an", () => {
    expect(sideNamesWithClub(single)).toBe("Anna Muster (VFC)");
    expect(sideNamesWithClub(pair)).toBe("Anna Muster (VFC) und Beat Beispiel");
  });
});
