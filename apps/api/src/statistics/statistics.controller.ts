import { Controller, Get, Inject, Param, ParseUUIDPipe } from "@nestjs/common";
import type { FrequentScores, PlayerStatisticsProfile } from "@darts-platform/schemas";
import { AllowDevice } from "../auth/allow-device.decorator.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { CurrentPrincipal } from "../auth/current-principal.decorator.js";
import type { AuthContext, Principal } from "../auth/auth.types.js";
import { StatisticsService } from "./statistics.service.js";

@Controller("organizations/:organizationId/players/:playerId/statistics")
export class StatisticsController {
  public constructor(@Inject(StatisticsService) private readonly service: StatisticsService) {}
  @Get()
  public profile(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("playerId", ParseUUIDPipe) playerId: string, @CurrentAuth() auth: AuthContext): Promise<PlayerStatisticsProfile> {
    return this.service.profile({ organizationId, playerId, auth });
  }

  @AllowDevice()
  @Get("frequent-scores")
  public frequentScores(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("playerId", ParseUUIDPipe) playerId: string,
    @CurrentPrincipal() auth: Principal,
  ): Promise<FrequentScores> {
    return this.service.frequentScores({ organizationId, playerId, auth });
  }
}
