import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module.js";
import { BoardsModule } from "./boards/boards.module.js";
import { CompetitionsModule } from "./competitions/competitions.module.js";
import { EnvironmentModule } from "./config/environment.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { EncountersModule } from "./encounters/encounters.module.js";
import { HealthModule } from "./health/health.module.js";
import { MatchesModule } from "./matches/matches.module.js";
import { OrganizationsModule } from "./organizations/organizations.module.js";
import { PlayersModule } from "./players/players.module.js";
import { RedisModule } from "./redis/redis.module.js";
import { RealtimeModule } from "./realtime/realtime.module.js";
import { TournamentsModule } from "./tournaments/tournaments.module.js";
import { StatisticsModule } from "./statistics/statistics.module.js";
import { TeamsModule } from "./teams/teams.module.js";

@Module({
  imports: [
    EnvironmentModule,
    DatabaseModule,
    RedisModule,
    RealtimeModule,
    AuthModule,
    BoardsModule,
    OrganizationsModule,
    PlayersModule,
    HealthModule,
    MatchesModule,
    TournamentsModule,
    StatisticsModule,
    TeamsModule,
    CompetitionsModule,
    EncountersModule,
  ],
})
export class AppModule {}
