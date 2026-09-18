import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import {
  createDisplayKeySchema,
  type CreateDisplayKeyInput,
  type CreatedDisplayKey,
  type DisplayKeyList,
} from "@darts-platform/schemas";

import type { ApplicationEnvironment } from "@darts-platform/config";

import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { getAuditContext } from "../common/audit-context.js";
import { parseBody } from "../common/parse-body.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { DisplayKeysService } from "./display-keys.service.js";

@Controller("organizations/:organizationId/tournaments/:tournamentId/display-keys")
export class DisplayKeysController {
  public constructor(
    @Inject(DisplayKeysService) private readonly service: DisplayKeysService,
    @Inject(APPLICATION_ENVIRONMENT)
    private readonly environment: ApplicationEnvironment,
  ) {}

  @Post()
  public create(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("tournamentId", ParseUUIDPipe) tournamentId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<CreatedDisplayKey> {
    const data: CreateDisplayKeyInput = parseBody(createDisplayKeySchema, body);
    return this.service.create({
      organizationId,
      tournamentId,
      data,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Get()
  public list(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("tournamentId", ParseUUIDPipe) tournamentId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DisplayKeyList> {
    return this.service.list({ organizationId, tournamentId, auth });
  }

  @Delete(":keyId")
  @HttpCode(204)
  public revoke(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("tournamentId", ParseUUIDPipe) tournamentId: string,
    @Param("keyId", ParseUUIDPipe) keyId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.service.revoke({
      organizationId,
      tournamentId,
      keyId,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }
}
