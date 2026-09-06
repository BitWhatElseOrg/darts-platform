import { describe, expect, it } from "vitest";

import {
  OUTBOX_BACKOFF_CAP_MS,
  OUTBOX_MAX_ATTEMPTS,
  outboxRetryDelayMs,
} from "./outbox.js";

describe("outboxRetryDelayMs", () => {
  it("verdoppelt die Wartezeit mit jedem Fehlversuch", () => {
    expect(outboxRetryDelayMs(1)).toBe(1_000);
    expect(outboxRetryDelayMs(2)).toBe(2_000);
    expect(outboxRetryDelayMs(3)).toBe(4_000);
    expect(outboxRetryDelayMs(4)).toBe(8_000);
  });

  it("deckelt die Wartezeit", () => {
    expect(outboxRetryDelayMs(50)).toBe(OUTBOX_BACKOFF_CAP_MS);
  });

  it("behandelt den ersten Versuch wie einen Fehlversuch", () => {
    expect(outboxRetryDelayMs(0)).toBe(1_000);
  });

  it("hält die Obergrenze bei fuenf Versuchen", () => {
    expect(OUTBOX_MAX_ATTEMPTS).toBe(5);
  });
});
