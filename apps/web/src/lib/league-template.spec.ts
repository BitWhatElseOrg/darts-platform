import { describe, expect, it } from "vitest";

import { createCompetitionSchema } from "@darts-platform/schemas";

import { buildEncounterTemplate, vfcTemplateOptions } from "@darts-platform/league-engine";

import { slugFromName } from "./league-template";

describe("slugFromName", () => {
  it("schreibt Umlaute aus, statt sie zu verschlucken", () => {
    expect(slugFromName("Gruppe Süd 2")).toBe("gruppe-sued-2");
    expect(slugFromName("Öffnungsrunde")).toBe("oeffnungsrunde");
  });

  it("liefert einen Wert, den der Vertrag annimmt", () => {
    const pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
    expect(pattern.test(slugFromName("  STSO S 2 — Saison 2026/27  "))).toBe(true);
    expect(slugFromName("  STSO S 2 — Saison 2026/27  ")).toBe("stso-s-2-saison-2026-27");
  });

  it("liefert bei einem Namen ohne brauchbare Zeichen eine leere Zeichenkette", () => {
    expect(slugFromName("///")).toBe("");
  });
});

describe("die erzeugte Vorlage gegen den API-Vertrag", () => {
  it("wird von createCompetitionSchema unveraendert angenommen", () => {
    const parsed = createCompetitionSchema.safeParse({
      type: "LEAGUE",
      name: "Gruppe STSO S 2",
      slug: slugFromName("Gruppe STSO S 2"),
      status: "ACTIVE",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      pointsDeciderBonus: 1,
      deciderRule: "EXTRA_SLOT",
      lineupPositions: 4,
      minNominations: 4,
      minNominationsShorthanded: 3,
      maxSubstitutionsPerEncounter: 4,
      maxDoublesPerPlayer: 1,
      slots: buildEncounterTemplate(vfcTemplateOptions),
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.slots).toHaveLength(19);
  });

  it("streicht den Zusatzpunkt, wenn kein Entscheidungsdoppel vorgesehen ist", () => {
    const parsed = createCompetitionSchema.safeParse({
      type: "LEAGUE",
      name: "Ohne Entscheidung",
      slug: "ohne-entscheidung",
      status: "ACTIVE",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      pointsDeciderBonus: 0,
      deciderRule: "NONE",
      lineupPositions: 4,
      minNominations: 4,
      minNominationsShorthanded: 3,
      maxSubstitutionsPerEncounter: 4,
      maxDoublesPerPlayer: 1,
      slots: buildEncounterTemplate({ ...vfcTemplateOptions, withDecider: false }),
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.pointsDeciderBonus).toBe(0);
    expect(parsed.success && parsed.data.slots).toHaveLength(18);
  });
});
