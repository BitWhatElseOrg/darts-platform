import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import type { ApplicationEnvironment } from "@darts-platform/config";
import {
  createBoardDeviceSchema,
  type BoardDeviceList,
  type CreateBoardDeviceInput,
  type CreatedBoardDevice,
} from "@darts-platform/schemas";

import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { getAuditContext } from "../common/audit-context.js";
import { parseBody } from "../common/parse-body.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { BoardDevicesService } from "./board-devices.service.js";

@Controller("organizations/:organizationId")
export class BoardDevicesController {
  public constructor(
    @Inject(BoardDevicesService) private readonly service: BoardDevicesService,
    @Inject(APPLICATION_ENVIRONMENT)
    private readonly environment: ApplicationEnvironment,
  ) {}

  @Post("boards/:boardId/devices")
  public pair(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("boardId", ParseUUIDPipe) boardId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<CreatedBoardDevice> {
    const data: CreateBoardDeviceInput = parseBody(createBoardDeviceSchema, body);
    return this.service.pair({
      organizationId,
      boardId,
      data,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Delete("boards/:boardId/devices/:deviceId")
  @HttpCode(204)
  public revoke(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("boardId", ParseUUIDPipe) boardId: string,
    @Param("deviceId", ParseUUIDPipe) deviceId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.service.revoke({
      organizationId,
      boardId,
      deviceId,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Get("board-devices")
  public list(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<BoardDeviceList> {
    return this.service.list({ organizationId, auth });
  }
}
