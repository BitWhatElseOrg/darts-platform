import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { MatchesController } from "./matches.controller.js";
import { MatchesRepository } from "./matches.repository.js";
import { MatchesService } from "./matches.service.js";

@Module({ imports: [DatabaseModule, OrganizationsModule], controllers: [MatchesController], providers: [MatchesRepository, MatchesService] })
export class MatchesModule {}
