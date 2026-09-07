import { Module } from "@nestjs/common";

import { HealthAlarmService } from "./health-alarm.service.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import { OutboxHealthService } from "./outbox-health.service.js";

@Module({
  controllers: [HealthController],
  providers: [HealthAlarmService, HealthService, OutboxHealthService],
})
export class HealthModule {}
