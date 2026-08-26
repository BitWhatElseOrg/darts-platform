import { Controller, Get, Inject, Param, ParseUUIDPipe } from "@nestjs/common";
import type { TournamentDashboard } from "@darts-platform/schemas";

import { Public } from "../auth/public.decorator.js";
import { TournamentsService } from "./tournaments.service.js";

@Public()
@Controller("public/tournaments")
export class PublicTournamentsController {
  public constructor(@Inject(TournamentsService) private readonly service: TournamentsService) {}

  @Get(":tournamentId/live")
  public live(
    @Param("tournamentId", ParseUUIDPipe) tournamentId: string,
  ): Promise<TournamentDashboard> {
    return this.service.publicDashboard(tournamentId);
  }
}
