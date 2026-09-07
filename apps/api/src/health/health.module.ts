import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import { OutboxHealthService } from "./outbox-health.service.js";

@Module({
  controllers: [HealthController],
  providers: [HealthService, OutboxHealthService],
})
export class HealthModule {}
