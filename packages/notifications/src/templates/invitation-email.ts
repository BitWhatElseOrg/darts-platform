import type { InvitationEmailPayload } from "@darts-platform/schemas";

import type { RenderedEmail } from "../email-message.js";
import { escapeHtml } from "../html.js";
import { formatDateTime, htmlLayout, textLayout } from "./layout.js";

const roleLabels: Readonly<Record<InvitationEmailPayload["role"], string>> = {
  OWNER: "Inhaber",
  ADMIN: "Administration",
  TOURNAMENT_DIRECTOR: "Turnierleitung",
  SCORER: "Scorer",
  MEMBER: "Mitglied",
  VIEWER: "Zuschauer",
};

/**
 * Einladungsmail. Der Link traegt den Code im Fragment; die Mail nennt den
 * Ablauf, damit niemand einem toten Link hinterherlaeuft.
 */
export function renderInvitationEmail(input: InvitationEmailPayload): RenderedEmail {
  const role = roleLabels[input.role];
  const inviter = input.inviterName.trim();
  const intro =
    inviter.length > 0
      ? `${inviter} hat dich zu ${input.organizationName} auf DartBase eingeladen, als ${role}.`
      : `Du wurdest zu ${input.organizationName} auf DartBase eingeladen, als ${role}.`;
  const expiry = `Die Einladung gilt bis ${formatDateTime(input.expiresAt)}.`;
  const instruction =
    "Öffne den folgenden Link, um dein Konto zu erstellen oder die Einladung mit deinem bestehenden Konto anzunehmen:";

  return {
    subject: `Einladung zu ${input.organizationName} auf DartBase`,
    text: textLayout([intro, instruction, input.invitationUrl, expiry]),
    html: htmlLayout({
      title: `Einladung zu ${input.organizationName}`,
      paragraphsHtml: [escapeHtml(intro), escapeHtml(instruction), escapeHtml(expiry)],
      action: { label: "Einladung öffnen", url: input.invitationUrl },
    }),
  };
}
