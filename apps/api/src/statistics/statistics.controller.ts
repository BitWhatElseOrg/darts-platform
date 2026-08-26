import { Controller, Get, Inject, Param, ParseUUIDPipe } from "@nestjs/common";
import type { PlayerStatisticsProfile } from "@darts-platform/schemas";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { StatisticsService } from "./statistics.service.js";

@Controller("organizations/:organizationId/players/:playerId/statistics")
export class StatisticsController {
  public constructor(@Inject(StatisticsService) private readonly service: StatisticsService) {}
  @Get()
  public profile(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("playerId", ParseUUIDPipe) playerId: string, @CurrentAuth() auth: AuthContext): Promise<PlayerStatisticsProfile> {
    return this.service.profile({ organizationId, playerId, auth });
  }
}
