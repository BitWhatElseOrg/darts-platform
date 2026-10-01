import { describe, expect, it } from "vitest";

import { clubAbbreviation } from "./club-label";

describe("clubAbbreviation", () => {
  it("bildet Initialen aus mehreren Wörtern, höchstens drei", () => {
    expect(clubAbbreviation("DC Musterdorf")).toBe("DM");
    expect(clubAbbreviation("Dartclub 1880 Musterdorf")).toBe("D1M");
    expect(clubAbbreviation("Verein für Freizeit und Chaos")).toBe("VFF");
  });

  it("nimmt bei einem Wort die ersten drei Zeichen in Grossbuchstaben", () => {
    expect(clubAbbreviation("VFC")).toBe("VFC");
    expect(clubAbbreviation("Musterdorf")).toBe("MUS");
    expect(clubAbbreviation("Öl")).toBe("ÖL");
  });

  it("ignoriert Trennzeichen und leere Teile", () => {
    expect(clubAbbreviation("  DC  -  Musterdorf ")).toBe("DM");
    expect(clubAbbreviation("")).toBe("");
  });
});
