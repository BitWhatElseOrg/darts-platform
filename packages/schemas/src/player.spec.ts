// Haelt fest, dass optionale Spielerfelder den Leerstring als "nicht
// angegeben" lesen — Formulare schicken fuer ein geleertes Feld `""`.
import { describe, expect, it } from "vitest";

import { createPlayerSchema, updatePlayerSchema } from "./player";

describe("createPlayerSchema", () => {
  it("nimmt einen leeren Spitznamen als nicht angegeben an", () => {
    const result = createPlayerSchema.parse({ displayName: "Anna Beispiel", nickname: "" });

    expect(result.nickname).toBeNull();
  });

  it("behandelt reine Leerzeichen wie einen leeren Spitznamen", () => {
    const result = createPlayerSchema.parse({ displayName: "Anna Beispiel", nickname: "   " });

    expect(result.nickname).toBeNull();
  });

  it("behaelt einen angegebenen Spitznamen getrimmt", () => {
    const result = createPlayerSchema.parse({ displayName: "Anna Beispiel", nickname: " Ann " });

    expect(result.nickname).toBe("Ann");
  });

  it("weist einen zu langen Spitznamen weiterhin zurueck", () => {
    expect(() =>
      createPlayerSchema.parse({ displayName: "Anna Beispiel", nickname: "x".repeat(101) }),
    ).toThrow();
  });

  it("verlangt weiterhin einen Anzeigenamen", () => {
    expect(() => createPlayerSchema.parse({ displayName: "" })).toThrow();
  });
});

describe("updatePlayerSchema", () => {
  it("loescht den Spitznamen, wenn das Feld geleert wird", () => {
    const result = updatePlayerSchema.parse({ nickname: "" });

    expect(result.nickname).toBeNull();
  });
});
