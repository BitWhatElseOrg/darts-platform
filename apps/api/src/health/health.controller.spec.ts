import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HealthResponse, OutboxHealth } from "@darts-platform/schemas";

import { DatabaseService } from "../database/database.service.js";
import { RedisService } from "../redis/redis.service.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import { OutboxHealthService } from "./outbox-health.service.js";

describe("GET /api/v1/health", () => {
  let app: NestFastifyApplication;
  const checkDatabase = vi.fn(async (): Promise<void> => undefined);
  const checkRedis = vi.fn(async (): Promise<void> => undefined);
  const healthyOutbox: OutboxHealth = {
    publishLagSeconds: 0,
    statisticsLagSeconds: null,
    deadLettered: 0,
  };
  const readOutbox = vi.fn(async (): Promise<OutboxHealth> => healthyOutbox);

  beforeEach(async () => {
    checkDatabase.mockClear();
    checkRedis.mockClear();
    readOutbox.mockClear();
    readOutbox.mockResolvedValue(healthyOutbox);

    const moduleReference = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        {
          provide: DatabaseService,
          useValue: { checkConnection: checkDatabase },
        },
        {
          provide: RedisService,
          useValue: { checkConnection: checkRedis },
        },
        {
          provide: OutboxHealthService,
          useValue: { read: readOutbox },
        },
      ],
    }).compile();

    app = moduleReference.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("reports healthy database and Redis dependencies", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/v1/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<HealthResponse>()).toEqual({
      status: "ok",
      services: {
        database: "ok",
        redis: "ok",
      },
      outbox: { publishLagSeconds: 0, statisticsLagSeconds: null, deadLettered: 0 },
    });
    expect(checkDatabase).toHaveBeenCalledOnce();
    expect(checkRedis).toHaveBeenCalledOnce();
  });

  it("reports an unhealthy state when a dependency is unavailable", async () => {
    checkRedis.mockRejectedValueOnce(new Error("Redis unavailable"));

    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/v1/health",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json<HealthResponse>()).toMatchObject({
      status: "unhealthy",
      services: {
        database: "ok",
        redis: "error",
      },
    });
  });

  it("meldet degraded bei Outbox-Rueckstand, ohne den Container abzuwerten", async () => {
    readOutbox.mockResolvedValue({
      publishLagSeconds: 120,
      statisticsLagSeconds: 0,
      deadLettered: 0,
    });

    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/v1/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<HealthResponse>()).toEqual({
      status: "degraded",
      services: {
        database: "ok",
        redis: "ok",
      },
      outbox: { publishLagSeconds: 120, statisticsLagSeconds: 0, deadLettered: 0 },
    });
  });

  it("meldet degraded, sobald ein Ereignis im Dead Letter liegt", async () => {
    readOutbox.mockResolvedValue({
      publishLagSeconds: 1,
      statisticsLagSeconds: 1,
      deadLettered: 2,
    });

    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/v1/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<HealthResponse>().status).toBe("degraded");
  });
});
