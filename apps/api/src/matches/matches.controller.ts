import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createMatchSchema, submitVisitSchema, undoVisitSchema, type CreateMatchInput, type MatchStateResponse, type SubmitVisitInput, type UndoVisitInput } from "@darts-platform/schemas";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { getAuditContext } from "../common/audit-context.js";
import { parseBody } from "../common/parse-body.js";
import { MatchesService } from "./matches.service.js";

@Controller("organizations/:organizationId/matches")
export class MatchesController {
  public constructor(@Inject(MatchesService) private readonly service: MatchesService) {}
  @Get() public list(@Param("organizationId", ParseUUIDPipe) organizationId: string, @CurrentAuth() auth: AuthContext): Promise<MatchStateResponse[]> { return this.service.list({ organizationId, auth }); }
  @Get(":matchId") public get(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("matchId", ParseUUIDPipe) matchId: string, @CurrentAuth() auth: AuthContext): Promise<MatchStateResponse> { return this.service.get({ organizationId, matchId, auth }); }
  @Post() public create(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<MatchStateResponse> {
    const data: CreateMatchInput = parseBody(createMatchSchema, body);
    return this.service.create({ organizationId, data, auth, audit: getAuditContext(request) });
  }
  @Post(":matchId/visits") public submitVisit(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("matchId", ParseUUIDPipe) matchId: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<MatchStateResponse> {
    const data: SubmitVisitInput = parseBody(submitVisitSchema, body);
    return this.service.submitVisit({ organizationId, matchId, data, auth, audit: getAuditContext(request) });
  }
  @Post(":matchId/undo") public undo(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("matchId", ParseUUIDPipe) matchId: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<MatchStateResponse> {
    const data: UndoVisitInput = parseBody(undoVisitSchema, body);
    return this.service.undo({ organizationId, matchId, data, auth, audit: getAuditContext(request) });
  }
}
