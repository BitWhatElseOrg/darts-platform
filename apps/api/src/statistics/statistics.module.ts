import { Module } from "@nestjs/common";
import { MatchesModule } from "../matches/matches.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { StatisticsController } from "./statistics.controller.js";
import { StatisticsRepository } from "./statistics.repository.js";
import { StatisticsService } from "./statistics.service.js";

@Module({ imports: [MatchesModule, OrganizationsModule], controllers: [StatisticsController], providers: [StatisticsRepository, StatisticsService] })
export class StatisticsModule {}
