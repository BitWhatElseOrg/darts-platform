import {
  emailDeliveryKindSchema,
  invitationEmailPayloadSchema,
  passwordResetEmailPayloadSchema,
} from "@darts-platform/schemas";

import type { RenderedEmail } from "./email-message.js";
import { renderInvitationEmail } from "./templates/invitation-email.js";
import { renderPasswordResetEmail } from "./templates/password-reset-email.js";

export type RenderEmailDeliveryResult =
  | { readonly ok: true; readonly email: RenderedEmail }
  | { readonly ok: false; readonly reason: string };

/**
 * Waehlt Template und Payload-Schema anhand von `kind`. Ein unpassender
 * Payload ist ein Ergebnis, kein Wurf: der Poller bucht ihn als Dead-Letter
 * und laeuft weiter.
 */
export function renderEmailDelivery(kind: string, payload: unknown): RenderEmailDeliveryResult {
  const parsedKind = emailDeliveryKindSchema.safeParse(kind);
  if (!parsedKind.success) {
    return { ok: false, reason: `Unbekannte Auftragsart: ${kind}` };
  }

  // Die Auftragsart steht in einer eigenen Konstante: `parsedKind` ist eine
  // discriminated union, und im `default`-Zweig waere das ganze Ergebnis
  // `never` — die never-Wache liesse sich dann nicht mehr schreiben.
  const deliveryKind = parsedKind.data;

  switch (deliveryKind) {
    case "INVITATION": {
      const parsed = invitationEmailPayloadSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, reason: `Payload ungültig: ${describeIssues(parsed.error)}` };
      return { ok: true, email: renderInvitationEmail(parsed.data) };
    }
    case "PASSWORD_RESET": {
      const parsed = passwordResetEmailPayloadSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, reason: `Payload ungültig: ${describeIssues(parsed.error)}` };
      return { ok: true, email: renderPasswordResetEmail(parsed.data) };
    }
    default: {
      const exhaustive: never = deliveryKind;
      return { ok: false, reason: `Unbekannte Auftragsart: ${String(exhaustive)}` };
    }
  }
}

function describeIssues(error: {
  readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
}): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join(".") || "payload"}: ${issue.message}`)
    .join("; ");
}
