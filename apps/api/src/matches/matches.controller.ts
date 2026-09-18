import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApplicationEnvironment } from "@darts-platform/config";
import { abortMatchSchema, boardControllerLeaseRequestSchema, createMatchSchema, decideLegByBullSchema, decideLegStartSchema, submitVisitSchema, undoVisitSchema, type AbortMatchInput, type AbortMatchResponse, type BoardControllerLeaseRequest, type BoardControllerLeaseResponse, type CreateMatchInput, type DecideLegByBullInput, type DecideLegStartInput, type MatchStateResponse, type SubmitVisitInput, type UndoVisitInput } from "@darts-platform/schemas";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { getAuditContext } from "../common/audit-context.js";
import { parseBody } from "../common/parse-body.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { MatchesService } from "./matches.service.js";

@Controller("organizations/:organizationId/matches")
export class MatchesController {
  public constructor(
    @Inject(MatchesService) private readonly service: MatchesService,
    @Inject(APPLICATION_ENVIRONMENT)
    private readonly environment: ApplicationEnvironment,
  ) {}
  @Get() public list(@Param("organizationId", ParseUUIDPipe) organizationId: string, @CurrentAuth() auth: AuthContext): Promise<MatchStateResponse[]> { return this.service.list({ organizationId, auth }); }
  @Get(":matchId") public get(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("matchId", ParseUUIDPipe) matchId: string, @CurrentAuth() auth: AuthContext): Promise<MatchStateResponse> { return this.service.get({ organizationId, matchId, auth }); }
  @Post() public create(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<MatchStateResponse> {
    const data: CreateMatchInput = parseBody(createMatchSchema, body);
    return this.service.create({ organizationId, data, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
  }
  @Post(":matchId/visits") public submitVisit(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("matchId", ParseUUIDPipe) matchId: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<MatchStateResponse> {
    const data: SubmitVisitInput = parseBody(submitVisitSchema, body);
    return this.service.submitVisit({ organizationId, matchId, data, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
  }
  @Post(":matchId/undo") public undo(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("matchId", ParseUUIDPipe) matchId: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<MatchStateResponse> {
    const data: UndoVisitInput = parseBody(undoVisitSchema, body);
    return this.service.undo({ organizationId, matchId, data, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
  }
  @Post(":matchId/leg-start") public decideLegStart(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("matchId", ParseUUIDPipe) matchId: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<MatchStateResponse> {
    const data: DecideLegStartInput = parseBody(decideLegStartSchema, body);
    return this.service.decideLegStart({ organizationId, matchId, data, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
  }
  @Post(":matchId/leg-by-bull") public decideLegByBull(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("matchId", ParseUUIDPipe) matchId: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<MatchStateResponse> {
    const data: DecideLegByBullInput = parseBody(decideLegByBullSchema, body);
    return this.service.decideLegByBull({ organizationId, matchId, data, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
  }
  @Post(":matchId/abort") public abort(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("matchId", ParseUUIDPipe) matchId: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<AbortMatchResponse> {
    const data: AbortMatchInput = parseBody(abortMatchSchema, body);
    return this.service.abort({ organizationId, matchId, data, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
  }
  @Post(":matchId/controller-lease") public controllerLease(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("matchId", ParseUUIDPipe) matchId: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<BoardControllerLeaseResponse> {
    const data: BoardControllerLeaseRequest = parseBody(boardControllerLeaseRequestSchema, body);
    return this.service.acquireControllerLease({ organizationId, matchId, controllerId: data.controllerId, force: data.force, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
  }
}
