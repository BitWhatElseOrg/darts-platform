import { z } from "zod";

export const playerStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

const optionalTrimmedString = (maximumLength: number) =>
  z.string().trim().min(1).max(maximumLength).nullable().optional();

export const createPlayerSchema = z.object({
  firstName: optionalTrimmedString(100),
  lastName: optionalTrimmedString(100),
  displayName: z.string().trim().min(1).max(255),
  nickname: optionalTrimmedString(100),
  email: z.email().trim().toLowerCase().nullable().optional(),
  externalReference: optionalTrimmedString(255),
  status: playerStatusSchema.default("ACTIVE"),
});

export const updatePlayerSchema = createPlayerSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one player field must be provided.",
);

export const playerSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  publicId: z.uuid(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  displayName: z.string(),
  nickname: z.string().nullable(),
  email: z.string().nullable(),
  externalReference: z.string().nullable(),
  status: playerStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const playerListSchema = z.array(playerSchema);

export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;
export type PlayerResponse = z.infer<typeof playerSchema>;
