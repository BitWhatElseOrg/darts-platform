import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import {
  assignMatchSchema,
  advancedFormatPreviewInputSchema,
  correctTournamentResultSchema,
  createTournamentSchema,
  releaseBoardSchema,
  setTournamentVisibilitySchema,
  tournamentStructurePreviewInputSchema,
  withdrawTournamentParticipantSchema,
  type AssignMatchInput,
  type AdvancedFormatPreview,
  type AdvancedFormatPreviewInput,
  type CorrectTournamentResultInput,
  type CreateTournamentInput,
  type ReleaseBoardInput,
  type SetTournamentVisibilityInput,
  type TournamentDashboard,
  type TournamentStructurePreview,
  type TournamentStructurePreviewInput,
  type TournamentSummary,
  type WithdrawTournamentParticipantInput,
} from "@darts-platform/schemas";

import type { ApplicationEnvironment } from "@darts-platform/config";

import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { getAuditContext } from "../common/audit-context.js";
import { parseBody } from "../common/parse-body.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { TournamentsService } from "./tournaments.service.js";

@Controller("organizations/:organizationId/tournaments")
export class TournamentsController {
  public constructor(
    @Inject(TournamentsService) private readonly service: TournamentsService,
    @Inject(APPLICATION_ENVIRONMENT)
    private readonly environment: ApplicationEnvironment,
  ) {}

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

  @Post("advanced-format-preview")
  public advancedPreview(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ): Promise<AdvancedFormatPreview> {
    const data: AdvancedFormatPreviewInput = parseBody(advancedFormatPreviewInputSchema, body);
    return this.service.advancedPreview({ organizationId, data, auth });
  }

  @Post()
  public create(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TournamentSummary> {
    const data: CreateTournamentInput = parseBody(createTournamentSchema, body);
    return this.service.create({ organizationId, data, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
  }

  @Delete(":tournamentId")
  @HttpCode(204)
  public delete(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("tournamentId", ParseUUIDPipe) tournamentId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.service.delete({ organizationId, tournamentId, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
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
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
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
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
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
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Post(":tournamentId/withdrawals")
  public withdrawParticipant(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("tournamentId", ParseUUIDPipe) tournamentId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TournamentDashboard> {
    const data: WithdrawTournamentParticipantInput = parseBody(withdrawTournamentParticipantSchema, body);
    return this.service.withdrawParticipant({ organizationId, tournamentId, data, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
  }

  @Patch(":tournamentId/visibility")
  public setVisibility(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("tournamentId", ParseUUIDPipe) tournamentId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TournamentDashboard> {
    const data: SetTournamentVisibilityInput = parseBody(setTournamentVisibilitySchema, body);
    return this.service.setVisibility({
      organizationId,
      tournamentId,
      data,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }
}
