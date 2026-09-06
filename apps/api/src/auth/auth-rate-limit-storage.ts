import { Logger } from "@nestjs/common";

import type { RedisService } from "../redis/redis.service.js";

export interface RateLimitRule {
  readonly window: number;
  readonly max: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfter: number | null;
}

/**
 * Die Form, die Better Auth als `rateLimit.customStorage` erwartet. Bewusst
 * strukturell nachgebaut statt aus `@better-auth/core` importiert: das Paket
 * ist in `apps/api` nur eine transitive Abhaengigkeit (Phantom-Dependency
 * unter pnpm), und die Struktur ist klein genug, dass ein Bruch beim
 * Aktualisieren sofort als Typfehler auffaellt.
 */
export interface RateLimitStorage {
  consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
}

export function createRedisRateLimitStorage(
  redisService: RedisService,
): RateLimitStorage {
  const logger = new Logger("AuthRateLimit");

  return {
    async consume(key, rule) {
      try {
        return await redisService.consumeRateLimit(
          `auth:${key}`,
          rule.window,
          rule.max,
        );
      } catch (error: unknown) {
        // Faellt Redis aus, bremst nichts mehr — die Anmeldung bleibt aber
        // erreichbar. Der Ausfall wird laut protokolliert, damit er nicht
        // stillschweigend zum Dauerzustand wird.
        logger.error(
          "Rate-Limit-Zaehler nicht erreichbar; die Anfrage wird durchgelassen",
          error instanceof Error ? error.stack : undefined,
        );
        return { allowed: true, retryAfter: null };
      }
    },
  };
}
