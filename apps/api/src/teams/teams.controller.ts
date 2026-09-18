import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import {
  addTeamMemberSchema,
  createTeamSchema,
  updateTeamSchema,
  type AddTeamMemberInput,
  type CreateTeamInput,
  type TeamResponse,
  type UpdateTeamInput,
} from "@darts-platform/schemas";

import type { ApplicationEnvironment } from "@darts-platform/config";

import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { getAuditContext } from "../common/audit-context.js";
import { parseBody } from "../common/parse-body.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { TeamsService } from "./teams.service.js";

@Controller("organizations/:organizationId/teams")
export class TeamsController {
  public constructor(
    @Inject(TeamsService) private readonly service: TeamsService,
    @Inject(APPLICATION_ENVIRONMENT)
    private readonly environment: ApplicationEnvironment,
  ) {}

  @Get()
  public list(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<TeamResponse[]> {
    return this.service.list({ organizationId, auth });
  }

  @Get(":teamId")
  public get(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("teamId", ParseUUIDPipe) teamId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<TeamResponse> {
    return this.service.get({ organizationId, teamId, auth });
  }

  @Post()
  public create(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TeamResponse> {
    const data: CreateTeamInput = parseBody(createTeamSchema, body);
    return this.service.create({ organizationId, data, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
  }

  @Patch(":teamId")
  public update(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("teamId", ParseUUIDPipe) teamId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TeamResponse> {
    const data: UpdateTeamInput = parseBody(updateTeamSchema, body);
    return this.service.update({ organizationId, teamId, data, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
  }

  @Post(":teamId/members")
  public addMember(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("teamId", ParseUUIDPipe) teamId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TeamResponse> {
    const data: AddTeamMemberInput = parseBody(addTeamMemberSchema, body);
    return this.service.addMember({ organizationId, teamId, data, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
  }

  @Delete(":teamId/members/:playerId")
  public removeMember(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("teamId", ParseUUIDPipe) teamId: string,
    @Param("playerId", ParseUUIDPipe) playerId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TeamResponse> {
    return this.service.removeMember({ organizationId, teamId, playerId, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
  }
}
