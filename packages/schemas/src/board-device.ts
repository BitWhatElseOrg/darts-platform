import { z } from "zod";

export const boardDeviceSelfSchema = z.object({
  device: z.object({ id: z.uuid(), label: z.string() }),
  board: z.object({ id: z.uuid(), name: z.string() }),
  organization: z.object({ id: z.uuid(), name: z.string() }),
  currentMatchId: z.uuid().nullable(),
});
export type BoardDeviceSelf = z.infer<typeof boardDeviceSelfSchema>;
