import type { PasswordResetEmailPayload } from "@darts-platform/schemas";

import type { RenderedEmail } from "../email-message.js";
import { escapeHtml } from "../html.js";
import { htmlLayout, textLayout } from "./layout.js";

/** Reset-Mail. Die Gueltigkeit von einer Stunde ist Better Auths Vorgabe. */
export function renderPasswordResetEmail(input: PasswordResetEmailPayload): RenderedEmail {
  const name = input.recipientName.trim();
  const greeting = name.length > 0 ? `Hallo ${name}` : "Hallo";
  const intro = `${greeting}, für dein DartBase-Konto wurde ein neues Passwort angefordert.`;
  const instruction = "Öffne den folgenden Link, um ein neues Passwort zu setzen. Er ist eine Stunde gültig:";

  return {
    subject: "Passwort zurücksetzen auf DartBase",
    text: textLayout([intro, instruction, input.resetUrl]),
    html: htmlLayout({
      title: "Passwort zurücksetzen",
      paragraphsHtml: [escapeHtml(intro), escapeHtml(instruction)],
      action: { label: "Neues Passwort setzen", url: input.resetUrl },
    }),
  };
}
