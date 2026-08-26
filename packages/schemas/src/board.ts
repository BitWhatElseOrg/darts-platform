import { z } from "zod";

export const boardStatusSchema = z.enum(["AVAILABLE", "IN_USE", "OFFLINE"]);
export const createBoardSchema = z.object({ name: z.string().trim().min(1).max(100) });
export const boardSchema = z.object({
  id: z.uuid(), organizationId: z.uuid(), name: z.string(), status: boardStatusSchema,
  createdAt: z.coerce.date(), updatedAt: z.coerce.date(),
});
export const boardListSchema = z.array(boardSchema);
export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type BoardResponse = z.infer<typeof boardSchema>;
