import { z } from "zod";

export const boardDeviceSelfSchema = z.object({
  device: z.object({ id: z.uuid(), label: z.string() }),
  board: z.object({ id: z.uuid(), name: z.string() }),
  organization: z.object({ id: z.uuid(), name: z.string() }),
  currentMatchId: z.uuid().nullable(),
});
export type BoardDeviceSelf = z.infer<typeof boardDeviceSelfSchema>;

export const createBoardDeviceSchema = z.object({ label: z.string().trim().min(1).max(80) });
export type CreateBoardDeviceInput = z.infer<typeof createBoardDeviceSchema>;

export const boardDeviceSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  label: z.string(),
  createdAt: z.coerce.date(),
  lastSeenAt: z.coerce.date().nullable(),
});
export type BoardDeviceResponse = z.infer<typeof boardDeviceSchema>;

export const boardDeviceListSchema = z.array(boardDeviceSchema);
export type BoardDeviceList = z.infer<typeof boardDeviceListSchema>;

export const createdBoardDeviceSchema = z.object({ device: boardDeviceSchema, secret: z.string() });
export type CreatedBoardDevice = z.infer<typeof createdBoardDeviceSchema>;
