import { Module } from "@nestjs/common";

import { OrganizationsModule } from "../organizations/organizations.module.js";
import { PlayersController } from "./players.controller.js";
import { PlayersRepository } from "./players.repository.js";
import { PlayersService } from "./players.service.js";

@Module({
  imports: [OrganizationsModule],
  controllers: [PlayersController],
  providers: [PlayersRepository, PlayersService],
})
export class PlayersModule {}
