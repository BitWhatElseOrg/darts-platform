import { z } from "zod";

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    correlationId: z.uuid(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;
