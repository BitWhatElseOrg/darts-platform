import { describe, expect, it } from "vitest";

import {
  createDisplayKeySecret,
  decideDisplayKeyState,
  hashDisplayKeySecret,
} from "./display-key";

describe("createDisplayKeySecret", () => {
  it("liefert jedes Mal einen anderen Wert", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => createDisplayKeySecret()));

    expect(secrets.size).toBe(50);
  });

  it("ist lang genug, dass Raten aussichtslos ist", () => {
    // 32 Bytes base64url — dieselbe Groessenordnung wie ein Sitzungstoken.
    expect(createDisplayKeySecret()).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });
});

describe("hashDisplayKeySecret", () => {
  it("bildet denselben Klartext auf denselben Hash ab", () => {
    expect(hashDisplayKeySecret("abc")).toBe(hashDisplayKeySecret("abc"));
  });

  it("liefert 64 Hex-Zeichen", () => {
    expect(hashDisplayKeySecret("abc")).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("gibt den Klartext nicht preis", () => {
    expect(hashDisplayKeySecret("abc")).not.toContain("abc");
  });
});

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
