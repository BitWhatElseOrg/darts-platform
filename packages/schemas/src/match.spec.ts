import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { abortMatchSchema, dartSchema, submitVisitSchema } from "./match.js";

describe("abort match contract", () => {
  it("accepts an idempotent versioned abort command", () => {
    expect(
      abortMatchSchema.parse({
        commandId: randomUUID(),
        expectedVersion: 2,
        controllerId: randomUUID(),
        reason: "  Technischer Neustart  ",
      }),
    ).toMatchObject({ expectedVersion: 2, reason: "Technischer Neustart" });
  });

  it("rejects an abort reason longer than 500 characters", () => {
    expect(
      abortMatchSchema.safeParse({
        commandId: randomUUID(),
        expectedVersion: 0,
        reason: "x".repeat(501),
      }).success,
    ).toBe(false);
  });

  it("requires a meaningful abort reason", () => {
    expect(
      abortMatchSchema.safeParse({
        commandId: randomUUID(),
        expectedVersion: 0,
      }).success,
    ).toBe(false);
  });
});

describe("dartSchema", () => {
  it("nimmt Triple 20 an", () => {
    expect(dartSchema.parse({ segment: 20, multiplier: 3 })).toEqual({ segment: 20, multiplier: 3 });
  });

  it("nimmt Bull als Doppel 25 an", () => {
    expect(dartSchema.safeParse({ segment: 25, multiplier: 2 }).success).toBe(true);
  });

  it("lehnt ein Segment zwischen 21 und 24 ab", () => {
    expect(dartSchema.safeParse({ segment: 21, multiplier: 1 }).success).toBe(false);
  });

  it("lehnt ein Triple auf Bull ab", () => {
    expect(dartSchema.safeParse({ segment: 25, multiplier: 3 }).success).toBe(false);
  });

  it("lehnt einen Fehlwurf mit Multiplikator ab", () => {
    expect(dartSchema.safeParse({ segment: 0, multiplier: 2 }).success).toBe(false);
  });
});

describe("submitVisitSchema mit Einzelwürfen", () => {
  const base = {
    commandId: "11111111-1111-4111-8111-111111111111",
    expectedVersion: 3,
    playerId: "22222222-2222-4222-8222-222222222222",
    points: 100,
    dartsThrown: 3 as const,
  };

  it("nimmt drei Würfe an, deren Summe den Punkten entspricht", () => {
    const parsed = submitVisitSchema.parse({
      ...base,
      darts: [{ segment: 20, multiplier: 3 }, { segment: 20, multiplier: 2 }, { segment: 0, multiplier: 1 }],
    });
    expect(parsed.darts).toHaveLength(3);
  });

  it("lehnt eine abweichende Summe ab", () => {
    const result = submitVisitSchema.safeParse({
      ...base,
      darts: [{ segment: 20, multiplier: 3 }, { segment: 1, multiplier: 1 }, { segment: 1, multiplier: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("lehnt eine andere Wurfzahl als dartsThrown ab", () => {
    const result = submitVisitSchema.safeParse({
      ...base,
      points: 60,
      darts: [{ segment: 20, multiplier: 3 }],
    });
    expect(result.success).toBe(false);
  });

  it("bleibt ohne Würfe gültig", () => {
    expect(submitVisitSchema.safeParse(base).success).toBe(true);
  });
});

describe("submitVisitSchema mit checkoutMissed", () => {
  const base = {
    commandId: "11111111-1111-4111-8111-111111111111",
    expectedVersion: 3,
    playerId: "22222222-2222-4222-8222-222222222222",
    points: 40,
    dartsThrown: 3 as const,
  };

  it("nimmt checkoutMissed allein an", () => {
    expect(submitVisitSchema.safeParse({ ...base, checkoutMissed: true }).success).toBe(true);
  });

  it("lehnt checkoutMissed zusammen mit einem Checkout-Doppel ab", () => {
    const result = submitVisitSchema.safeParse({ ...base, checkoutMissed: true, checkoutDouble: 20 });
    expect(result.success).toBe(false);
  });

  it("lehnt checkoutMissed zusammen mit Einzelwürfen ab", () => {
    const result = submitVisitSchema.safeParse({
      ...base,
      checkoutMissed: true,
      darts: [{ segment: 20, multiplier: 2 }, { segment: 0, multiplier: 1 }, { segment: 0, multiplier: 1 }],
    });
    expect(result.success).toBe(false);
  });
});
