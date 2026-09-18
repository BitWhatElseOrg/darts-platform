import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import {
  createPlayerSchema,
  updatePlayerSchema,
  type CreatePlayerInput,
  type PlayerResponse,
  type UpdatePlayerInput,
} from "@darts-platform/schemas";

import type { ApplicationEnvironment } from "@darts-platform/config";

import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { getAuditContext } from "../common/audit-context.js";
import { parseBody } from "../common/parse-body.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { PlayersService } from "./players.service.js";

@Controller("organizations/:organizationId/players")
export class PlayersController {
  public constructor(
    @Inject(PlayersService) private readonly playersService: PlayersService,
    @Inject(APPLICATION_ENVIRONMENT)
    private readonly environment: ApplicationEnvironment,
  ) {}

  @Get()
  public async list(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<PlayerResponse[]> {
    return this.playersService.list({ organizationId, auth });
  }

  @Get(":playerId")
  public async get(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("playerId", ParseUUIDPipe) playerId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<PlayerResponse> {
    return this.playersService.get({ organizationId, playerId, auth });
  }

  @Post()
  public async create(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<PlayerResponse> {
    const data: CreatePlayerInput = parseBody(createPlayerSchema, body);
    return this.playersService.create({
      organizationId,
      data,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Patch(":playerId")
  public async update(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("playerId", ParseUUIDPipe) playerId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<PlayerResponse> {
    const data: UpdatePlayerInput = parseBody(updatePlayerSchema, body);
    return this.playersService.update({
      organizationId,
      playerId,
      data,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Delete(":playerId")
  public async archive(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("playerId", ParseUUIDPipe) playerId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<PlayerResponse> {
    return this.playersService.archive({
      organizationId,
      playerId,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Get(":playerId/avatar")
  public async avatar(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("playerId", ParseUUIDPipe) playerId: string,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const avatar = await this.playersService.getAvatar({ organizationId, playerId, auth });
    // Die Adresse trägt die Prüfsumme als `?v=`; eine Änderung bricht den
    // Cache dadurch von selbst, und der Browser lädt jedes Bild genau einmal.
    reply.header("Content-Type", avatar.contentType);
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    reply.header("ETag", `"${avatar.checksum}"`);
    // `private` allein schuetzt nicht vor einem zweiten Konto im selben
    // Browserprofil: der Cache kennt keine Sitzung. `Vary: Cookie` bindet den
    // Cache-Eintrag an das Sitzungs-Cookie, unter dem er entstand — ein
    // Kontowechsel im selben Browser trifft damit nie den fremden Eintrag.
    reply.header("Vary", "Cookie");
    return avatar.bytes;
  }

  @Put(":playerId/avatar")
  public async setAvatar(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("playerId", ParseUUIDPipe) playerId: string,
    @Body() body: Buffer,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<PlayerResponse> {
    return this.playersService.setAvatar({
      organizationId,
      playerId,
      body,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Delete(":playerId/avatar")
  public async removeAvatar(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("playerId", ParseUUIDPipe) playerId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<PlayerResponse> {
    return this.playersService.removeAvatar({
      organizationId,
      playerId,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }
}
