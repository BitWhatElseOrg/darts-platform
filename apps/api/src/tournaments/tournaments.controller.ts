import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import {
  assignMatchSchema,
  correctTournamentResultSchema,
  createTournamentSchema,
  releaseBoardSchema,
  tournamentStructurePreviewInputSchema,
  type AssignMatchInput,
  type CorrectTournamentResultInput,
  type CreateTournamentInput,
  type ReleaseBoardInput,
  type TournamentDashboard,
  type TournamentStructurePreview,
  type TournamentStructurePreviewInput,
  type TournamentSummary,
} from "@darts-platform/schemas";

import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { getAuditContext } from "../common/audit-context.js";
import { parseBody } from "../common/parse-body.js";
import { TournamentsService } from "./tournaments.service.js";

@Controller("organizations/:organizationId/tournaments")
export class TournamentsController {
  public constructor(@Inject(TournamentsService) private readonly service: TournamentsService) {}

  @Get()
  public list(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<TournamentSummary[]> {
    return this.service.list({ organizationId, auth });
  }

  @Post("structure-preview")
  public preview(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ): Promise<TournamentStructurePreview> {
    const data: TournamentStructurePreviewInput = parseBody(
      tournamentStructurePreviewInputSchema,
      body,
    );
    return this.service.preview({ organizationId, data, auth });
  }

  @Post()
  public create(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TournamentSummary> {
    const data: CreateTournamentInput = parseBody(createTournamentSchema, body);
    return this.service.create({ organizationId, data, auth, audit: getAuditContext(request) });
  }

  @Get(":tournamentId/dashboard")
  public dashboard(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("tournamentId", ParseUUIDPipe) tournamentId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<TournamentDashboard> {
    return this.service.dashboard({ organizationId, tournamentId, auth });
  }

  @Post(":tournamentId/assignments")
  public assign(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("tournamentId", ParseUUIDPipe) tournamentId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TournamentDashboard> {
    const data: AssignMatchInput = parseBody(assignMatchSchema, body);
    return this.service.assign({
      organizationId,
      tournamentId,
      data,
      auth,
      audit: getAuditContext(request),
    });
  }

  @Post(":tournamentId/board-releases")
  public releaseBoard(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("tournamentId", ParseUUIDPipe) tournamentId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TournamentDashboard> {
    const data: ReleaseBoardInput = parseBody(releaseBoardSchema, body);
    return this.service.releaseBoard({
      organizationId,
      tournamentId,
      data,
      auth,
      audit: getAuditContext(request),
    });
  }

  @Post(":tournamentId/result-corrections")
  public correctResult(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("tournamentId", ParseUUIDPipe) tournamentId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TournamentDashboard> {
    const data: CorrectTournamentResultInput = parseBody(correctTournamentResultSchema, body);
    return this.service.correctResult({
      organizationId,
      tournamentId,
      data,
      auth,
      audit: getAuditContext(request),
    });
  }
}
