import { describe, expect, it } from "vitest";

import { decideSubscription } from "./subscription-access";

const base = {
  target: "known",
  visibility: "PRIVATE",
  membership: "none",
  displayKey: "absent",
} as const;

describe("decideSubscription", () => {
  it("laesst jeden in ein oeffentliches Turnier", () => {
    expect(decideSubscription({ ...base, visibility: "PUBLIC" })).toEqual({ kind: "allow" });
  });

  it("laesst ein Mitglied in ein privates Turnier", () => {
    expect(decideSubscription({ ...base, membership: "member" })).toEqual({ kind: "allow" });
  });

  it("laesst einen gueltigen Anzeige-Schluessel in ein privates Turnier", () => {
    expect(decideSubscription({ ...base, displayKey: "valid" })).toEqual({ kind: "allow" });
  });

  it("weist ein privates Turnier ohne jeden Nachweis ab", () => {
    expect(decideSubscription(base)).toEqual({
      kind: "deny",
      reason: "SUBSCRIPTION_FORBIDDEN",
    });
  });

  it("weist einen abgelaufenen Schluessel ab", () => {
    expect(decideSubscription({ ...base, displayKey: "expired" })).toEqual({
      kind: "deny",
      reason: "SUBSCRIPTION_FORBIDDEN",
    });
  });

  it("weist einen widerrufenen Schluessel ab", () => {
    expect(decideSubscription({ ...base, displayKey: "revoked" })).toEqual({
      kind: "deny",
      reason: "SUBSCRIPTION_FORBIDDEN",
    });
  });

  it("nennt eine unbekannte Adresse unbekannt, auch wenn sie oeffentlich waere", () => {
    expect(
      decideSubscription({ ...base, target: "unknown", visibility: "PUBLIC" }),
    ).toEqual({ kind: "deny", reason: "SUBSCRIPTION_UNKNOWN_ROOM" });
  });

  it("laesst ein Mitglied auch mit abgelaufenem Schluessel hinein", () => {
    // Die Nachweise sind alternativ, nicht kumulativ: ein totes Tablet-Token
    // darf einer angemeldeten Turnierleitung nicht den Kanal verschliessen.
    expect(
      decideSubscription({ ...base, membership: "member", displayKey: "expired" }),
    ).toEqual({ kind: "allow" });
  });
});
