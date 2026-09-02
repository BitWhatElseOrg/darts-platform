import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { TeamsController } from "./teams.controller.js";
import { TeamsRepository } from "./teams.repository.js";
import { TeamsService } from "./teams.service.js";

@Module({
  imports: [DatabaseModule, OrganizationsModule],
  controllers: [TeamsController],
  providers: [TeamsRepository, TeamsService],
  exports: [TeamsRepository],
})
export class TeamsModule {}
