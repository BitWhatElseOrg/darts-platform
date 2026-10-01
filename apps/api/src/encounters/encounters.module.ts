import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { MatchesModule } from "../matches/matches.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { EncountersController } from "./encounters.controller.js";
import { EncountersRepository } from "./encounters.repository.js";
import { EncountersService } from "./encounters.service.js";
import { PublicEncountersController } from "./public-encounters.controller.js";

@Module({
  imports: [DatabaseModule, MatchesModule, OrganizationsModule],
  controllers: [EncountersController, PublicEncountersController],
  providers: [EncountersRepository, EncountersService],
  exports: [EncountersRepository],
})
export class EncountersModule {}
