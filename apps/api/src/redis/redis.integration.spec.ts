import { afterAll, describe, expect, it } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";

import { RedisService } from "./redis.service.js";

const redisService = new RedisService(
  parseApplicationEnvironment(process.env),
);

afterAll(async () => {
  await redisService.onApplicationShutdown();
});

describe("Redis connection", () => {
  it("receives PONG from Redis", async () => {
    await expect(redisService.checkConnection()).resolves.toBeUndefined();
  });
});
