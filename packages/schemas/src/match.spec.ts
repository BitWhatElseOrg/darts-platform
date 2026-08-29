import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { abortMatchSchema } from "./match";

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
