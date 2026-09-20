import { describe, expect, it } from "vitest";

import { renderInvitationEmail } from "./invitation-email.js";

const input = {
  organizationName: "Beispielverein",
  inviterName: "Alex Muster",
  role: "SCORER" as const,
  invitationUrl: "https://dartbase.example/einladung/11111111-1111-4111-8111-111111111111#code=abc_DEF-123",
  expiresAt: new Date("2026-09-22T10:30:00.000Z"),
};

describe("renderInvitationEmail", () => {
  it("nennt Organisation, Rolle und Link im Betreff und im Text", () => {
    const email = renderInvitationEmail(input);
    expect(email.subject).toBe("Einladung zu Beispielverein auf DartBase");
    expect(email.text).toContain("Alex Muster");
    expect(email.text).toContain("Scorer");
    expect(email.text).toContain(input.invitationUrl);
    expect(email.html).toContain(`href="${input.invitationUrl}"`);
  });

  it("formatiert den Ablauf in Schweizer Schreibweise und Zeitzone Zürich", () => {
    const email = renderInvitationEmail(input);
    // 10:30 UTC ist im September 12:30 in Zürich (Sommerzeit).
    expect(email.text).toContain("22.09.2026, 12:30");
  });

  it("escaped Benutzereingaben im HTML", () => {
    const email = renderInvitationEmail({ ...input, organizationName: "<script>alert(1)</script>" });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("verzichtet auf den Namen der einladenden Person, wenn er leer ist", () => {
    const email = renderInvitationEmail({ ...input, inviterName: "" });
    expect(email.text).toContain("Du wurdest zu Beispielverein auf DartBase eingeladen");
    expect(email.text).not.toContain(" hat dich ");
  });

  it("traegt den Hinweis fuer unerwartete Mails", () => {
    expect(renderInvitationEmail(input).text).toContain("nicht erwartet");
  });
});
