import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { BoardsController } from "./boards.controller.js";
import { BoardsService } from "./boards.service.js";

@Module({ imports: [DatabaseModule, OrganizationsModule], controllers: [BoardsController], providers: [BoardsService], exports: [BoardsService] })
export class BoardsModule {}
