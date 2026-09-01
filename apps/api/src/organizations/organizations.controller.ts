import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import {
  createInvitationSchema,
  createOrganizationSchema,
  type CreateInvitationInput,
  type CreateOrganizationInput,
  type CreatedInvitation,
  type OrganizationSummary,
} from "@darts-platform/schemas";

import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { getAuditContext } from "../common/audit-context.js";
import { parseBody } from "../common/parse-body.js";
import { OrganizationsService } from "./organizations.service.js";

@Controller("organizations")
export class OrganizationsController {
  public constructor(
    @Inject(OrganizationsService)
    private readonly organizationsService: OrganizationsService,
  ) {}

  @Get()
  public async list(
    @CurrentAuth() auth: AuthContext,
  ): Promise<OrganizationSummary[]> {
    return this.organizationsService.list(auth);
  }

  @Post()
  public async create(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<OrganizationSummary> {
    const data: CreateOrganizationInput = parseBody(
      createOrganizationSchema,
      body,
    );
    return this.organizationsService.create({
      data,
      auth,
      audit: getAuditContext(request),
    });
  }

  @Post(":organizationId/invitations")
  public async invite(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<CreatedInvitation> {
    const data: CreateInvitationInput = parseBody(createInvitationSchema, body);
    return this.organizationsService.invite({
      organizationId,
      data,
      auth,
      audit: getAuditContext(request),
    });
  }
}
