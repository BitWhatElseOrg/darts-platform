import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import {
  assignEncounterSlotSchema,
  cancelEncounterSchema,
  createEncounterSchema,
  declareEncounterForfeitSchema,
  declareSlotWalkoverSchema,
  releaseEncounterSlotSchema,
  startEncounterSchema,
  submitDoublesSchema,
  submitNominationsSchema,
  substitutePlayerSchema,
  type EncounterDetail,
  type EncounterSummary,
} from "@darts-platform/schemas";

import type { ApplicationEnvironment } from "@darts-platform/config";

import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { getAuditContext } from "../common/audit-context.js";
import { parseBody } from "../common/parse-body.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { EncountersService } from "./encounters.service.js";

@Controller("organizations/:organizationId")
export class EncountersController {
  public constructor(
    @Inject(EncountersService) private readonly service: EncountersService,
    @Inject(APPLICATION_ENVIRONMENT)
    private readonly environment: ApplicationEnvironment,
  ) {}

  @Get("competitions/:competitionId/encounters")
  public list(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("competitionId", ParseUUIDPipe) competitionId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<EncounterSummary[]> {
    return this.service.list({ organizationId, competitionId, auth });
  }

  @Post("competitions/:competitionId/encounters")
  public schedule(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("competitionId", ParseUUIDPipe) competitionId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<EncounterDetail> {
    return this.service.schedule({
      organizationId,
      competitionId,
      data: parseBody(createEncounterSchema, body),
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Get("encounters/:encounterId")
  public get(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("encounterId", ParseUUIDPipe) encounterId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<EncounterDetail> {
    return this.service.get({ organizationId, encounterId, auth });
  }

  @Post("encounters/:encounterId/nominations")
  public submitNominations(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("encounterId", ParseUUIDPipe) encounterId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<EncounterDetail> {
    return this.service.submitNominations({
      organizationId,
      encounterId,
      data: parseBody(submitNominationsSchema, body),
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Post("encounters/:encounterId/doubles")
  public submitDoubles(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("encounterId", ParseUUIDPipe) encounterId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<EncounterDetail> {
    return this.service.submitDoubles({
      organizationId,
      encounterId,
      data: parseBody(submitDoublesSchema, body),
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Post("encounters/:encounterId/substitutions")
  public substitute(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("encounterId", ParseUUIDPipe) encounterId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<EncounterDetail> {
    return this.service.substitute({
      organizationId,
      encounterId,
      data: parseBody(substitutePlayerSchema, body),
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Post("encounters/:encounterId/start")
  public start(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("encounterId", ParseUUIDPipe) encounterId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<EncounterDetail> {
    return this.service.start({
      organizationId,
      encounterId,
      data: parseBody(startEncounterSchema, body),
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Post("encounters/:encounterId/slots/:slotId/assign")
  public assignSlot(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("encounterId", ParseUUIDPipe) encounterId: string,
    @Param("slotId", ParseUUIDPipe) slotId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<EncounterDetail> {
    return this.service.assignSlot({
      organizationId,
      encounterId,
      slotId,
      data: parseBody(assignEncounterSlotSchema, body),
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Post("encounters/:encounterId/slots/:slotId/release")
  public releaseSlot(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("encounterId", ParseUUIDPipe) encounterId: string,
    @Param("slotId", ParseUUIDPipe) slotId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<EncounterDetail> {
    return this.service.releaseSlot({
      organizationId,
      encounterId,
      slotId,
      data: parseBody(releaseEncounterSlotSchema, body),
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Post("encounters/:encounterId/slots/:slotId/walkover")
  public declareSlotWalkover(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("encounterId", ParseUUIDPipe) encounterId: string,
    @Param("slotId", ParseUUIDPipe) slotId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<EncounterDetail> {
    return this.service.declareSlotWalkover({
      organizationId,
      encounterId,
      slotId,
      data: parseBody(declareSlotWalkoverSchema, body),
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Post("encounters/:encounterId/forfeit")
  public declareForfeit(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("encounterId", ParseUUIDPipe) encounterId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<EncounterDetail> {
    return this.service.declareForfeit({
      organizationId,
      encounterId,
      data: parseBody(declareEncounterForfeitSchema, body),
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Post("encounters/:encounterId/cancel")
  public cancel(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("encounterId", ParseUUIDPipe) encounterId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<EncounterDetail> {
    return this.service.cancel({
      organizationId,
      encounterId,
      data: parseBody(cancelEncounterSchema, body),
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }
}
