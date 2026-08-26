import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { MatchesModule } from "../matches/matches.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { TournamentsController } from "./tournaments.controller.js";
import { PublicTournamentsController } from "./public-tournaments.controller.js";
import { TournamentsRepository } from "./tournaments.repository.js";
import { TournamentsService } from "./tournaments.service.js";

@Module({
  imports: [DatabaseModule, MatchesModule, OrganizationsModule],
  controllers: [TournamentsController, PublicTournamentsController],
  providers: [TournamentsRepository, TournamentsService],
})
export class TournamentsModule {}
