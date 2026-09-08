import { describe, expect, it } from "vitest";

import { decideDisplayKeyState } from "./display-key-state";

describe("decideDisplayKeyState", () => {
  const now = new Date("2026-09-07T20:00:00.000Z");

  it("gilt vor dem Ablauf", () => {
    expect(
      decideDisplayKeyState({
        expiresAt: new Date("2026-09-07T21:00:00.000Z"),
        revokedAt: null,
        now,
      }),
    ).toBe("valid");
  });

  it("ist nach dem Ablauf abgelaufen", () => {
    expect(
      decideDisplayKeyState({
        expiresAt: new Date("2026-09-07T19:59:59.000Z"),
        revokedAt: null,
        now,
      }),
    ).toBe("expired");
  });

  it("ist im Ablaufmoment selbst abgelaufen", () => {
    expect(decideDisplayKeyState({ expiresAt: now, revokedAt: null, now })).toBe("expired");
  });

  it("bleibt widerrufen, auch wenn der Ablauf noch nicht erreicht ist", () => {
    expect(
      decideDisplayKeyState({
        expiresAt: new Date("2026-09-07T23:00:00.000Z"),
        revokedAt: new Date("2026-09-07T19:00:00.000Z"),
        now,
      }),
    ).toBe("revoked");
  });
});
