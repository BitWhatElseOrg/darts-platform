import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import type { HealthResponse } from "@darts-platform/schemas";

import { Public } from "../auth/public.decorator.js";
import { HealthService } from "./health.service.js";

@Controller("health")
@Public()
export class HealthController {
  public constructor(
    @Inject(HealthService) private readonly healthService: HealthService,
  ) {}

  @Get()
  public async getHealth(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<HealthResponse> {
    const health = await this.healthService.getHealth();
    // Nur eine fehlende Abhängigkeit ist ein 503. Ein Outbox-Rückstand
    // bleibt 200: Railway nutzt diesen Pfad als Deploy-Gate
    // (.railway/railway.ts) und dürfte deswegen kein Deployment abweisen.
    if (health.status === "unhealthy") {
      reply.status(503);
    }
    return health;
  }
}
