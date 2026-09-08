import { Controller, Get, Inject, Param, ParseUUIDPipe } from "@nestjs/common";
import type { PublicTournamentDashboard } from "@darts-platform/schemas";

import { Public } from "../auth/public.decorator.js";
import { TournamentsService } from "./tournaments.service.js";

@Public()
@Controller("public/tournaments")
export class PublicTournamentsController {
  public constructor(@Inject(TournamentsService) private readonly service: TournamentsService) {}

  @Get(":publicId/live")
  public live(
    @Param("publicId", ParseUUIDPipe) publicId: string,
  ): Promise<PublicTournamentDashboard> {
    return this.service.publicDashboard(publicId);
  }

  /**
   * Uebergangsweg fuer Links, die vor der Umstellung auf `public_id` geteilt
   * wurden: er uebersetzt die interne ID in die oeffentliche Adresse, damit
   * die Weboberflaeche umleiten kann. Er gibt nichts als die `publicId`
   * preis und nur fuer ein oeffentliches Turnier.
   *
   * ENTFERNEN: eigener PR, geplant bis Ende Oktober 2026. Solange diese Route
   * steht, bleibt die interne ID ein gueltiger Adressweg.
   */
  @Get(":tournamentId/address")
  public address(
    @Param("tournamentId", ParseUUIDPipe) tournamentId: string,
  ): Promise<{ readonly publicId: string }> {
    return this.service.publicAddress(tournamentId);
  }
}
