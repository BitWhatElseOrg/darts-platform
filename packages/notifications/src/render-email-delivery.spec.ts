import { describe, expect, it } from "vitest";

import { renderEmailDelivery } from "./render-email-delivery.js";

describe("renderEmailDelivery", () => {
  it("rendert eine Einladung aus Kind und Payload", () => {
    const result = renderEmailDelivery("INVITATION", {
      organizationName: "Beispielverein",
      inviterName: "Alex",
      role: "MEMBER",
      invitationUrl: "https://dartbase.example/einladung/x#code=y",
      expiresAt: "2026-09-22T10:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.email.subject).toContain("Beispielverein");
  });

  it("rendert einen Passwort-Reset", () => {
    const result = renderEmailDelivery("PASSWORD_RESET", {
      recipientName: "Alex",
      resetUrl: "https://api.dartbase.example/api/v1/auth/reset-password/t?callbackURL=c",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.email.subject).toBe("Passwort zurücksetzen auf DartBase");
  });

  it("meldet eine unbekannte Auftragsart als Fehler statt zu werfen", () => {
    const result = renderEmailDelivery("NEWSLETTER", {});
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("NEWSLETTER") });
  });

  it("meldet einen Payload, der nicht zum Schema passt", () => {
    const result = renderEmailDelivery("INVITATION", { organizationName: "V" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("invitationUrl");
  });

  it("meldet einen leeren Payload", () => {
    expect(renderEmailDelivery("INVITATION", null).ok).toBe(false);
  });
});
