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

export const bootstrapOrganizationSchema = createOrganizationSchema.extend({
  email: z.email().trim().toLowerCase(),
  expiresInDays: z.coerce.number().int().min(1).max(90).default(7),
});

export const organizationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  locale: z.string(),
  role: organizationRoleSchema,
});

export const organizationListSchema = z.array(organizationSummarySchema);

export const createInvitationSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: invitableOrganizationRoleSchema,
});

export const invitationSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  organizationName: z.string().optional(),
  email: z.email(),
  role: invitableOrganizationRoleSchema,
  status: z.enum(["PENDING", "ACCEPTED", "CANCELLED", "EXPIRED"]),
  expiresAt: z.coerce.date(),
});

export const invitationListSchema = z.array(invitationSchema);

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type BootstrapOrganizationInput = z.infer<
  typeof bootstrapOrganizationSchema
>;
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
