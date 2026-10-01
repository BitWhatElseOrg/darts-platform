import { describe, expect, it } from "vitest";

import { BOARD_DEVICE_SECRET_PREFIX, createBoardDeviceSecret, hashBoardDeviceSecret } from "./board-device-secret";

describe("board device secret", () => {
  it("trägt das Präfix bd_ und 32 Zufallsbytes base64url", () => {
    const secret = createBoardDeviceSecret();
    expect(secret.startsWith(BOARD_DEVICE_SECRET_PREFIX)).toBe(true);
    expect(secret.slice(3)).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(createBoardDeviceSecret()).not.toBe(secret);
  });

  it("hasht deterministisch zu 64 Hex-Zeichen", () => {
    expect(hashBoardDeviceSecret("bd_abc")).toBe(hashBoardDeviceSecret("bd_abc"));
    expect(hashBoardDeviceSecret("bd_abc")).toMatch(/^[a-f0-9]{64}$/u);
  });
});
