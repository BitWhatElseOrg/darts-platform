import { z } from "zod";

/**
 * Eine numerische Offset-Zeitzone (z. B. "+01:00") ist kein IANA-Name und
 * traegt keine DST-Regeln — sie darf trotz gueltiger `Intl`-Aufloesung nicht
 * gespeichert werden. Node loest sie klaglos auf sich selbst auf (empirisch
 * geprueft, Node 24: `new Intl.DateTimeFormat("en-US", { timeZone: "+01:00"
 * }).resolvedOptions().timeZone === "+01:00"`), waehrend ein unbekannter Name
 * wie "GMT+1" eine Exception wirft.
 */
const OFFSET_TIMEZONE_PATTERN = /^[+-]\d/;

/**
 * Kanonisiert eine Zeitzonenangabe ueber eine echte `Intl.DateTimeFormat`-
 * Instanziierung statt einer Listenpruefung: `Intl.supportedValuesOf
 * ("timeZone")` fehlt in dieser Node-Version "UTC", und die Aufloesung
 * erledigt gleichzeitig Gross-/Kleinschreibung ("europe/zurich" ->
 * "Europe/Zurich") und veraltete Aliase ("US/Pacific" ->
 * "America/Los_Angeles", "EST" -> "America/Panama" — empirisch mit Node 24
 * geprueft; beides sind gueltige IANA-Namen, `EST` ist im tzdata-Backward-File
 * ein fixer Offset ohne DST, dessen Aequivalent Panama ist). `null` bei einer
 * unbekannten Zeitzone oder einem numerischen Offset.
 */
function canonicalTimeZone(value: string): string | null {
  if (OFFSET_TIMEZONE_PATTERN.test(value)) return null;
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
    return OFFSET_TIMEZONE_PATTERN.test(resolved) ? null : resolved;
  } catch {
    return null;
  }
}

/** `null` bei einem Sprachtag, das `Intl.getCanonicalLocales` zurueckweist. */
function canonicalLocale(value: string): string | null {
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null;
  } catch {
    return null;
  }
}

const timezoneValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .transform((value, ctx) => {
    const canonical = canonicalTimeZone(value);
    if (canonical === null) {
      ctx.addIssue({ code: "custom", message: "Unbekannte Zeitzone." });
      return z.NEVER;
    }
    return canonical;
  });

const localeValueSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .transform((value, ctx) => {
    const canonical = canonicalLocale(value);
    if (canonical === null) {
      ctx.addIssue({ code: "custom", message: "Unbekannte Sprache." });
      return z.NEVER;
    }
    return canonical;
  });

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
  timezone: timezoneValueSchema.default("Europe/Zurich"),
  locale: localeValueSchema.default("de-CH"),
});

/**
 * Schreibgrenze der Stammdaten. Der Slug bleibt aussen vor: er steht in
 * oeffentlichen Adressen und Einladungen, eine Umbenennung wuerde sie
 * still ungueltig machen.
 */
export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(255).optional(),
    timezone: timezoneValueSchema.optional(),
    locale: localeValueSchema.optional(),
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

/**
 * Was die Plattform an Wegen ueberhaupt offen haelt — unabhaengig von einer
 * einzelnen Organisation. Die Oberflaeche fragt das ab, statt ein Formular
 * anzubieten, das der Server anschliessend mit 403 abweist.
 */
export const organizationCapabilitiesSchema = z.object({
  selfServiceEnabled: z.boolean(),
});

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

/**
 * Zustand der juengsten Zustellung einer Einladung. `pending`: Auftrag
 * liegt beim Worker; `sent`: Provider hat angenommen; `failed`: Dead-Letter
 * nach erschoepften Versuchen oder endgueltiger Ablehnung.
 */
export const invitationDeliveryStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("sent"), sentAt: z.coerce.date() }),
  z.object({ status: z.literal("failed"), failedAt: z.coerce.date() }),
]);

export const invitationSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  organizationName: z.string().optional(),
  email: z.email(),
  role: organizationRoleSchema,
  status: z.enum(["PENDING", "ACCEPTED", "CANCELLED", "EXPIRED"]),
  expiresAt: z.coerce.date(),
  /**
   * Juengste Zustellung, nur in der Organisationsliste gefuellt. `null`:
   * Einladung aus der Zeit vor dem Mailversand; fehlt: Antwort eines
   * Endpunkts, der den Status nicht liefert.
   */
  lastDelivery: invitationDeliveryStatusSchema.nullable().optional(),
});

export const invitationListSchema = z.array(invitationSchema);

export const createdInvitationSchema = invitationSchema.extend({
  claimToken: invitationClaimTokenSchema,
});

export const acceptInvitationSchema = z.object({
  claimToken: invitationClaimTokenSchema,
});

/** Body des oeffentlichen Vorschau-Endpunkts: nur der Code. */
export const previewInvitationInputSchema = z.object({
  claimToken: invitationClaimTokenSchema,
});

/**
 * Was die Einladungsseite vor der Registrierung anzeigen darf. Nur nach
 * erfolgreichem Hash-Vergleich; sonst antwortet der Server mit 404, ohne
 * die Ursache zu nennen.
 */
export const invitationPreviewSchema = z.object({
  organizationName: z.string(),
  role: organizationRoleSchema,
  email: z.email(),
  expiresAt: z.coerce.date(),
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

/** Bestaetigung beim Loeschen: der Name muss eingetippt werden (Spec 2026-09-24). */
export const deleteOrganizationSchema = z.object({
  confirmName: z.string().trim().min(1).max(255),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type DeleteOrganizationInput = z.infer<typeof deleteOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type OrganizationCapabilities = z.infer<
  typeof organizationCapabilitiesSchema
>;
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
export type InvitationDeliveryStatus = z.infer<typeof invitationDeliveryStatusSchema>;
export type PreviewInvitationInput = z.infer<typeof previewInvitationInputSchema>;
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
