import { describe, expect, it } from "vitest";

import {
  emailDeliveryKindSchema,
  invitationEmailPayloadSchema,
  passwordResetEmailPayloadSchema,
} from "./email-delivery";
import { invitationDeliveryStatusSchema, invitationSchema } from "./organization";

describe("emailDeliveryKindSchema", () => {
  it("kennt genau die beiden Auftragsarten", () => {
    expect(emailDeliveryKindSchema.options).toEqual(["INVITATION", "PASSWORD_RESET"]);
  });
});

describe("invitationEmailPayloadSchema", () => {
  it("nimmt den Ablauf als ISO-String entgegen und liefert ein Date", () => {
    const parsed = invitationEmailPayloadSchema.parse({
      organizationName: "Beispielverein",
      inviterName: "Alex Muster",
      role: "MEMBER",
      invitationUrl: "https://dartbase.example/einladung/abc#code=xyz",
      expiresAt: "2026-09-22T12:00:00.000Z",
    });
    expect(parsed.expiresAt).toBeInstanceOf(Date);
  });

  it("weist eine ungültige Rolle und eine Nicht-URL ab", () => {
    expect(
      invitationEmailPayloadSchema.safeParse({
        organizationName: "V",
        inviterName: "A",
        role: "KING",
        invitationUrl: "nicht-url",
        expiresAt: "2026-09-22T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("passwordResetEmailPayloadSchema", () => {
  it("verlangt eine Reset-URL", () => {
    expect(passwordResetEmailPayloadSchema.safeParse({ recipientName: "A" }).success).toBe(false);
    expect(
      passwordResetEmailPayloadSchema.parse({
        recipientName: "A",
        resetUrl: "https://api.dartbase.example/api/v1/auth/reset-password/t?callbackURL=x",
      }).resetUrl,
    ).toContain("reset-password");
  });
});

describe("invitationDeliveryStatusSchema", () => {
  it("unterscheidet ausstehend, versendet und fehlgeschlagen", () => {
    expect(invitationDeliveryStatusSchema.parse({ status: "pending" })).toEqual({ status: "pending" });
    expect(
      invitationDeliveryStatusSchema.parse({ status: "sent", sentAt: "2026-09-20T10:00:00.000Z" }).status,
    ).toBe("sent");
    expect(
      invitationDeliveryStatusSchema.parse({ status: "failed", failedAt: "2026-09-20T10:00:00.000Z" }).status,
    ).toBe("failed");
  });

  it("bleibt in invitationSchema optional, damit ältere Antworten weiter parsen", () => {
    const parsed = invitationSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      email: "gast@example.test",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: "2026-09-22T12:00:00.000Z",
    });
    expect(parsed.lastDelivery).toBeUndefined();
  });
});
