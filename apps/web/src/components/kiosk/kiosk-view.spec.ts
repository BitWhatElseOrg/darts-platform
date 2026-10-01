import { describe, expect, it } from "vitest";

import { KIOSK_END_HOLD_MS, kioskView } from "./kiosk-view";

const base = { currentMatchId: null, lastMatchId: null, lastMatchCompletedAt: null, dismissedMatchId: null, now: 1_000_000 };

describe("kioskView", () => {
  it("wartet ohne Match", () => {
    expect(kioskView(base)).toEqual({ kind: "idle" });
  });

  it("zeigt das laufende Match der Scheibe", () => {
    expect(kioskView({ ...base, currentMatchId: "m1" })).toEqual({ kind: "match", matchId: "m1" });
  });

  it("hält den Endstand 30 Sekunden", () => {
    const ended = { ...base, lastMatchId: "m1", lastMatchCompletedAt: base.now - KIOSK_END_HOLD_MS + 1 };
    expect(kioskView(ended)).toEqual({ kind: "ended", matchId: "m1" });
    expect(kioskView({ ...ended, now: base.now + 1 })).toEqual({ kind: "idle" });
  });

  it("verlässt den Endstand sofort nach «Weiter»", () => {
    expect(kioskView({ ...base, lastMatchId: "m1", lastMatchCompletedAt: base.now, dismissedMatchId: "m1" })).toEqual({ kind: "idle" });
  });

  it("zeigt ein neues Match auch während des Endstands", () => {
    expect(kioskView({ ...base, currentMatchId: "m2", lastMatchId: "m1", lastMatchCompletedAt: base.now })).toEqual({ kind: "match", matchId: "m2" });
  });
});
