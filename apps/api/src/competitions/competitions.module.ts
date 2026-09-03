import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { CompetitionsController } from "./competitions.controller.js";
import { CompetitionsRepository } from "./competitions.repository.js";
import { CompetitionsService } from "./competitions.service.js";

@Module({
  imports: [DatabaseModule, OrganizationsModule],
  controllers: [CompetitionsController],
  providers: [CompetitionsRepository, CompetitionsService],
  exports: [CompetitionsRepository, CompetitionsService],
})
export class CompetitionsModule {}
