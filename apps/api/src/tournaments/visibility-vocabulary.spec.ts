import { describe, expect, it } from "vitest";

import { tournamentVisibilities } from "@darts-platform/domain";
import { tournamentVisibilitySchema } from "@darts-platform/schemas";

describe("Sichtbarkeitsstufen", () => {
  it("sind in Domain und Schemas dieselben", () => {
    // Die beiden Listen leben getrennt, damit `packages/schemas` keine
    // Abhaengigkeit auf die Domain braucht. Diese Zusicherung ist der Preis
    // dafuer: driften sie auseinander, faellt es hier auf und nicht im Betrieb.
    expect([...tournamentVisibilities]).toEqual(tournamentVisibilitySchema.options);
  });
});
