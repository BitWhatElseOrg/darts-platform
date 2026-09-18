import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApplicationEnvironment } from "@darts-platform/config";
import { createBoardSchema, type BoardResponse, type CreateBoardInput } from "@darts-platform/schemas";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { getAuditContext } from "../common/audit-context.js";
import { parseBody } from "../common/parse-body.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { BoardsService } from "./boards.service.js";

@Controller("organizations/:organizationId/boards")
export class BoardsController {
  public constructor(
    @Inject(BoardsService) private readonly service: BoardsService,
    @Inject(APPLICATION_ENVIRONMENT)
    private readonly environment: ApplicationEnvironment,
  ) {}
  @Get() public list(@Param("organizationId", ParseUUIDPipe) organizationId: string, @CurrentAuth() auth: AuthContext): Promise<BoardResponse[]> { return this.service.list({ organizationId, auth }); }
  @Post() public create(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<BoardResponse> {
    const data: CreateBoardInput = parseBody(createBoardSchema, body);
    return this.service.create({ organizationId, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS), data });
  }
}
