import { describe, expect, it } from "vitest";

import { describeInvitationDelivery } from "./invitation-delivery.js";

const at = new Date("2026-09-20T10:00:00.000Z");

describe("describeInvitationDelivery", () => {
  it("liefert null ohne Zustellzeile (Einladung vor dem Mailversand)", () => {
    expect(describeInvitationDelivery(undefined)).toBeNull();
  });

  it("liefert pending fuer eine offene Zeile", () => {
    expect(describeInvitationDelivery({ sentAt: null, deadLetteredAt: null })).toEqual({ status: "pending" });
  });

  it("liefert sent mit Zeitpunkt", () => {
    expect(describeInvitationDelivery({ sentAt: at, deadLetteredAt: null })).toEqual({ status: "sent", sentAt: at });
  });

  it("liefert failed mit Zeitpunkt", () => {
    expect(describeInvitationDelivery({ sentAt: null, deadLetteredAt: at })).toEqual({ status: "failed", failedAt: at });
  });
});
