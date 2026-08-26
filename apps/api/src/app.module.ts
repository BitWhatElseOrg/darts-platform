import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module.js";
import { EnvironmentModule } from "./config/environment.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { OrganizationsModule } from "./organizations/organizations.module.js";
import { PlayersModule } from "./players/players.module.js";
import { RedisModule } from "./redis/redis.module.js";

@Module({
  imports: [
    EnvironmentModule,
    DatabaseModule,
    RedisModule,
    AuthModule,
    OrganizationsModule,
    PlayersModule,
    HealthModule,
  ],
})
export class AppModule {}
