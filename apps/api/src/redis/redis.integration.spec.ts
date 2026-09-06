import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";

import { parseApplicationEnvironment } from "@darts-platform/config";

import { RedisService } from "./redis.service.js";

const environment = parseApplicationEnvironment(process.env);
const redisService = new RedisService(environment);

afterAll(async () => {
  await redisService.onApplicationShutdown();
});

describe("Redis connection", () => {
  it("receives PONG from Redis", async () => {
    await expect(redisService.checkConnection()).resolves.toBeUndefined();
  });
});

describe("RedisService.consumeRateLimit", () => {
  it("heilt einen Schluessel, der seine Ablaufzeit verloren hat", async () => {
    const rawClient = createClient({ url: environment.REDIS_URL });
    await rawClient.connect();

    try {
      const key = `heal-${randomUUID()}`;
      const namespacedKey = `rate-limit:${key}`;

      // Simuliert einen Schluessel, dessen `EXPIRE` nie ausgefuehrt wurde
      // (z. B. Prozessabsturz zwischen `INCR` und `EXPIRE`): ein `SET` ohne
      // Ablaufzeit.
      await rawClient.set(namespacedKey, "5");
      expect(await rawClient.ttl(namespacedKey)).toBe(-1);

      await redisService.consumeRateLimit(key, 60, 100);

      expect(await rawClient.ttl(namespacedKey)).toBeGreaterThan(0);
    } finally {
      await rawClient.quit();
    }
  });
});
