import { describe, expect, it } from "vitest";

import { avatarTone, playerInitials } from "./player-avatar";

describe("playerInitials", () => {
  it("nimmt die Anfangsbuchstaben der ersten beiden Wörter", () => {
    expect(playerInitials("Alex Muster")).toBe("AM");
  });

  it("nimmt bei einem einzelnen Wort nur dessen ersten Buchstaben", () => {
    expect(playerInitials("Alex")).toBe("A");
  });

  it("überspringt zusätzliche Wörter", () => {
    expect(playerInitials("Jordan van der Beispiel")).toBe("JV");
  });

  it("verträgt mehrfache Leerzeichen und Ränder", () => {
    expect(playerInitials("  Alex   Muster  ")).toBe("AM");
  });

  it("liefert für einen leeren Namen ein Fragezeichen statt einer leeren Fläche", () => {
    expect(playerInitials("   ")).toBe("?");
  });
});

describe("avatarTone", () => {
  it("liefert denselben Farbwinkel für dieselbe Kennung", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(avatarTone(id)).toBe(avatarTone(id));
  });

  it("bleibt im Bereich von 0 bis 359", () => {
    for (const id of ["a", "b", "11111111-1111-4111-8111-111111111111", ""]) {
      const tone = avatarTone(id);
      expect(Number.isInteger(tone)).toBe(true);
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(360);
    }
  });

  it("trennt verschiedene Kennungen", () => {
    expect(avatarTone("11111111-1111-4111-8111-111111111111")).not.toBe(
      avatarTone("22222222-2222-4222-8222-222222222222"),
    );
  });
});
