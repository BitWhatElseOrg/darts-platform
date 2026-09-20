import { z } from "zod";

import { organizationRoleSchema } from "./organization";

/**
 * Arten von Versandauftraegen in `email_deliveries`. Der Worker waehlt
 * anhand dieses Werts das Template; die Datenbank sichert ihn per
 * Check-Constraint (`email_deliveries_kind_check`).
 */
export const emailDeliveryKindSchema = z.enum(["INVITATION", "PASSWORD_RESET"]);

/**
 * Template-Eingaben der Einladungsmail. `invitationUrl` traegt den
 * Klartext-Code im Fragment; die Zeile wird nach dem Versand geleert.
 */
export const invitationEmailPayloadSchema = z.object({
  organizationName: z.string().min(1),
  inviterName: z.string(),
  role: organizationRoleSchema,
  invitationUrl: z.url(),
  expiresAt: z.coerce.date(),
});

/** Template-Eingaben der Reset-Mail; die URL stammt von Better Auth. */
export const passwordResetEmailPayloadSchema = z.object({
  recipientName: z.string(),
  resetUrl: z.url(),
});

export type EmailDeliveryKind = z.infer<typeof emailDeliveryKindSchema>;
export type InvitationEmailPayload = z.infer<typeof invitationEmailPayloadSchema>;
export type PasswordResetEmailPayload = z.infer<typeof passwordResetEmailPayloadSchema>;
