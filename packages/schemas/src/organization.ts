import { z } from "zod";

export const organizationRoleSchema = z.enum([
  "OWNER",
  "ADMIN",
  "TOURNAMENT_DIRECTOR",
  "SCORER",
  "MEMBER",
  "VIEWER",
]);

export const invitableOrganizationRoleSchema = z.enum([
  "ADMIN",
  "TOURNAMENT_DIRECTOR",
  "SCORER",
  "MEMBER",
  "VIEWER",
]);

/** Alle Zustaende, die die Datenbank kennt (`memberships_status_check`). */
export const membershipStatusSchema = z.enum(["INVITED", "ACTIVE", "SUSPENDED"]);

/**
 * Was ueber die API gesetzt werden darf. `INVITED` entsteht ausschliesslich
 * im Einladungspfad und wird nicht von Hand vergeben.
 */
export const assignableMembershipStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(255),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  timezone: z.string().trim().min(1).max(100).default("Europe/Zurich"),
  locale: z.string().trim().min(2).max(35).default("de-CH"),
});

/**
 * Schreibgrenze der Stammdaten. Der Slug bleibt aussen vor: er steht in
 * oeffentlichen Adressen und Einladungen, eine Umbenennung wuerde sie
 * still ungueltig machen.
 */
export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(255).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    locale: z.string().trim().min(2).max(35).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one organization field must be provided.",
  });

export const organizationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  locale: z.string(),
  role: organizationRoleSchema,
  /**
   * Das eigene Spielerprofil in dieser Organisation, sofern verknuepft.
   * Beantwortet „welcher Spieler bin ich“, ohne dass es dafuer einen
   * eigenen Endpunkt braucht.
   */
  playerId: z.uuid().nullable(),
});

export const organizationListSchema = z.array(organizationSummarySchema);

export const createInvitationSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: invitableOrganizationRoleSchema,
  /**
   * Optionaler Spielerbezug. Wird er gesetzt, verknuepft die Annahme der
   * Einladung Konto und Spielerprofil in derselben Transaktion (ADR 0015).
   * Einladen ohne Spielerbezug bleibt der Normalfall.
   */
  playerId: z.uuid().optional(),
});

export const invitationClaimTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{43}$/);

export const invitationSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  organizationName: z.string().optional(),
  email: z.email(),
  role: organizationRoleSchema,
  status: z.enum(["PENDING", "ACCEPTED", "CANCELLED", "EXPIRED"]),
  expiresAt: z.coerce.date(),
});

export const invitationListSchema = z.array(invitationSchema);

export const createdInvitationSchema = invitationSchema.extend({
  claimToken: invitationClaimTokenSchema,
});

export const acceptInvitationSchema = z.object({
  claimToken: invitationClaimTokenSchema,
});

export const linkedPlayerSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
});

export const organizationMemberSchema = z.object({
  userId: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  role: organizationRoleSchema,
  status: membershipStatusSchema,
  /** Das zugeordnete Spielerprofil, sofern vorhanden (ADR 0015). */
  player: linkedPlayerSchema.nullable(),
});

/** Schreibgrenze der manuellen Zuordnung Konto -> Spieler. */
export const linkMemberPlayerSchema = z.object({
  playerId: z.uuid(),
});

export const organizationMemberListSchema = z.array(organizationMemberSchema);

/**
 * `OWNER` ist hier zugelassen, damit Eigentum uebertragbar bleibt — ein
 * Vorstandswechsel darf nicht am Schema scheitern. Wer OWNER vergeben darf,
 * entscheidet der Service: nur eine handelnde Person, die selbst aktiver
 * OWNER derselben Organisation ist. Der Einladungspfad
 * (`createInvitationSchema`) schliesst OWNER weiterhin aus.
 */
export const updateMembershipSchema = z
  .object({
    role: organizationRoleSchema.optional(),
    status: assignableMembershipStatusSchema.optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: "either role or status must be given",
  });

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type CreatedInvitation = z.infer<typeof createdInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type MembershipStatusValue = z.infer<typeof membershipStatusSchema>;
export type OrganizationMember = z.infer<typeof organizationMemberSchema>;
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;
export type LinkedPlayer = z.infer<typeof linkedPlayerSchema>;
export type LinkMemberPlayerInput = z.infer<typeof linkMemberPlayerSchema>;
