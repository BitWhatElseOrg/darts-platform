import { z } from "zod";

export const serviceHealthStatusSchema = z.enum(["ok", "error"]);

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  services: z.object({
    database: serviceHealthStatusSchema,
    redis: serviceHealthStatusSchema,
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ServiceHealthStatus = z.infer<typeof serviceHealthStatusSchema>;
