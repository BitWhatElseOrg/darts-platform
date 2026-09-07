import { z } from "zod";

export const serviceHealthStatusSchema = z.enum(["ok", "error"]);

export const outboxHealthSchema = z.object({
  /** Alter des ältesten unverteilten Ereignisses in Sekunden, null wenn keines offen ist. */
  publishLagSeconds: z.number().nonnegative().nullable(),
  /** Dasselbe für den Statistik-Konsumenten (nur MATCH_COMPLETED). */
  statisticsLagSeconds: z.number().nonnegative().nullable(),
  /** Zeilen, die ein Konsument nach zu vielen Fehlversuchen übersprungen hat. */
  deadLettered: z.number().int().nonnegative(),
});

export const healthResponseSchema = z.object({
  // "unhealthy" bedeutet: eine Abhängigkeit fehlt, HTTP 503. "degraded"
  // bleibt HTTP 200 — Railway und Playwright warten auf 200, und ein
  // Outbox-Rückstand darf kein Deployment blockieren.
  status: z.enum(["ok", "degraded", "unhealthy"]),
  services: z.object({
    database: serviceHealthStatusSchema,
    redis: serviceHealthStatusSchema,
  }),
  outbox: outboxHealthSchema,
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type OutboxHealth = z.infer<typeof outboxHealthSchema>;
export type ServiceHealthStatus = z.infer<typeof serviceHealthStatusSchema>;
