import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { MatchesModule } from "../matches/matches.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { DisplayKeysController } from "./display-keys.controller.js";
import { DisplayKeysRepository } from "./display-keys.repository.js";
import { DisplayKeysService } from "./display-keys.service.js";
import { TournamentsController } from "./tournaments.controller.js";
import { PublicTournamentsController } from "./public-tournaments.controller.js";
import { TournamentsRepository } from "./tournaments.repository.js";
import { TournamentsService } from "./tournaments.service.js";

@Module({
  imports: [DatabaseModule, MatchesModule, OrganizationsModule],
  controllers: [TournamentsController, PublicTournamentsController, DisplayKeysController],
  providers: [TournamentsRepository, TournamentsService, DisplayKeysRepository, DisplayKeysService],
})
export class TournamentsModule {}
