import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";

import { RedisService } from "../redis/redis.service.js";
import { createRedisRateLimitStorage } from "./auth-rate-limit-storage.js";

const redisService = new RedisService(parseApplicationEnvironment(process.env));
const storage = createRedisRateLimitStorage(redisService);

afterAll(async () => {
  await redisService.onApplicationShutdown();
});

describe("Redis-gestuetzter Rate-Limit-Zaehler", () => {
  it("laesst genau `max` Anfragen im Fenster durch und sperrt danach", async () => {
    const key = `spec-${randomUUID()}`;
    const rule = { window: 60, max: 2 } as const;

    expect(await storage.consume(key, rule)).toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect(await storage.consume(key, rule)).toEqual({
      allowed: true,
      retryAfter: null,
    });

    const denied = await storage.consume(key, rule);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThan(0);
    expect(denied.retryAfter).toBeLessThanOrEqual(60);
  }, 30_000);

  it("zaehlt je Schluessel getrennt", async () => {
    const rule = { window: 60, max: 1 } as const;
    const firstKey = `spec-${randomUUID()}`;
    const secondKey = `spec-${randomUUID()}`;

    expect((await storage.consume(firstKey, rule)).allowed).toBe(true);
    expect((await storage.consume(firstKey, rule)).allowed).toBe(false);
    expect((await storage.consume(secondKey, rule)).allowed).toBe(true);
  }, 30_000);
});
