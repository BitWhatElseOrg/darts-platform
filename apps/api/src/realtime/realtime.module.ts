import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { EncountersModule } from "../encounters/encounters.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { TournamentsModule } from "../tournaments/tournaments.module.js";
import { RealtimeService } from "./realtime.service.js";
import { SubscriptionAuthorization } from "./subscription-authorization.js";

@Module({
  imports: [DatabaseModule, AuthModule, TournamentsModule, OrganizationsModule, EncountersModule],
  providers: [RealtimeService, SubscriptionAuthorization],
  exports: [RealtimeService],
})
export class RealtimeModule {}
