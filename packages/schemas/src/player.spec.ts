// Haelt fest, dass optionale Spielerfelder den Leerstring als "nicht
// angegeben" lesen — Formulare schicken fuer ein geleertes Feld `""`.
import { describe, expect, it } from "vitest";

import { createGuestPlayersSchema, createPlayerSchema, playerKindFilterSchema, updatePlayerSchema } from "./player";

// Alle Felder, die den gemeinsamen Helfer nutzen, samt ihrer Laengengrenze.
const optionalFields = [
  { field: "firstName", maximumLength: 100 },
  { field: "lastName", maximumLength: 100 },
  { field: "nickname", maximumLength: 100 },
  { field: "externalReference", maximumLength: 255 },
] as const;

describe("createPlayerSchema", () => {
  describe.each(optionalFields)("$field", ({ field, maximumLength }) => {
    it("liest den Leerstring als nicht angegeben", () => {
      const result = createPlayerSchema.parse({ displayName: "Anna Beispiel", [field]: "" });

      expect(result[field]).toBeNull();
    });

    it("behandelt reine Leerzeichen wie einen Leerstring", () => {
      const result = createPlayerSchema.parse({ displayName: "Anna Beispiel", [field]: "   " });

      expect(result[field]).toBeNull();
    });

    it("behaelt einen angegebenen Wert getrimmt", () => {
      const result = createPlayerSchema.parse({ displayName: "Anna Beispiel", [field]: " Ann " });

      expect(result[field]).toBe("Ann");
    });

    it("laesst ein fehlendes Feld fehlend", () => {
      const result = createPlayerSchema.parse({ displayName: "Anna Beispiel" });

      expect(result[field]).toBeUndefined();
    });

    it("nimmt null weiterhin an", () => {
      const result = createPlayerSchema.parse({ displayName: "Anna Beispiel", [field]: null });

      expect(result[field]).toBeNull();
    });

    it("weist einen zu langen Wert weiterhin zurueck", () => {
      expect(() =>
        createPlayerSchema.parse({
          displayName: "Anna Beispiel",
          [field]: "x".repeat(maximumLength + 1),
        }),
      ).toThrow();
    });

    it("nimmt einen Wert genau an der Grenze an", () => {
      const value = "x".repeat(maximumLength);
      const result = createPlayerSchema.parse({ displayName: "Anna Beispiel", [field]: value });

      expect(result[field]).toBe(value);
    });
  });

  it("verlangt weiterhin einen Anzeigenamen", () => {
    expect(() => createPlayerSchema.parse({ displayName: "" })).toThrow();
  });

  it("weist einen zu langen Anzeigenamen weiterhin zurueck", () => {
    expect(() => createPlayerSchema.parse({ displayName: "x".repeat(256) })).toThrow();
  });
});

describe("updatePlayerSchema", () => {
  describe.each(optionalFields)("$field", ({ field }) => {
    it("loescht den Wert, wenn das Feld geleert wird", () => {
      const result = updatePlayerSchema.parse({ [field]: "" });

      expect(result[field]).toBeNull();
    });
  });

  it("erzwingt keinen Status, wenn keiner angegeben wird", () => {
    // Regression: `createPlayerSchema.partial()` liess den `.default("ACTIVE")`
    // aus dem Basisschema wirken, sodass jedes Update ohne Statusfeld einen
    // archivierten Spieler stillschweigend reaktivierte.
    const result = updatePlayerSchema.parse({ displayName: "Anna Beispiel" });

    expect(result).not.toHaveProperty("status");
  });

  it("verlangt weiterhin mindestens ein Feld, auch ohne Status", () => {
    expect(() => updatePlayerSchema.parse({})).toThrow();
  });

  it("nimmt einen ausdruecklich angegebenen Status weiterhin an", () => {
    const result = updatePlayerSchema.parse({ status: "ACTIVE" });

    expect(result.status).toBe("ACTIVE");
  });
});

describe("guest players contract", () => {
  const commandId = "0d1f6d2e-4b1a-4c2e-9f3a-1b2c3d4e5f60";
  it("accepts up to 64 distinct trimmed names and defaults the list filter to MEMBER", () => {
    const parsed = createGuestPlayersSchema.parse({ commandId, clubName: " DC Musterdorf ", names: [" Anna ", "Beat"] });
    expect(parsed.clubName).toBe("DC Musterdorf");
    expect(parsed.names).toEqual(["Anna", "Beat"]);
    expect(createGuestPlayersSchema.safeParse({ commandId, clubName: "DC", names: ["Anna", "anna"] }).success).toBe(false);
    expect(createGuestPlayersSchema.safeParse({ commandId, clubName: "DC", names: [] }).success).toBe(false);
    expect(playerKindFilterSchema.parse(undefined)).toBe("MEMBER");
  });
});
