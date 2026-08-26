import { Inject, Injectable } from "@nestjs/common";

import type {
  HealthResponse,
  ServiceHealthStatus,
} from "@darts-platform/schemas";

import { DatabaseService } from "../database/database.service.js";
import { RedisService } from "../redis/redis.service.js";

@Injectable()
export class HealthService {
  public constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(RedisService) private readonly redisService: RedisService,
  ) {}

  private async check(checker: () => Promise<void>): Promise<ServiceHealthStatus> {
    try {
      await checker();
      return "ok";
    } catch {
      return "error";
    }
  }

  public async getHealth(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      this.check(() => this.databaseService.checkConnection()),
      this.check(() => this.redisService.checkConnection()),
    ]);

    return {
      status: database === "ok" && redis === "ok" ? "ok" : "degraded",
      services: {
        database,
        redis,
      },
    };
  }
}
