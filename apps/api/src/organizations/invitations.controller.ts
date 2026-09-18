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

import type { ApplicationEnvironment } from "@darts-platform/config";
import {
  acceptInvitationSchema,
  type AcceptInvitationInput,
  type Invitation,
} from "@darts-platform/schemas";

import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { getAuditContext } from "../common/audit-context.js";
import { parseBody } from "../common/parse-body.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { OrganizationsService } from "./organizations.service.js";

@Controller("invitations")
export class InvitationsController {
  public constructor(
    @Inject(OrganizationsService)
    private readonly organizationsService: OrganizationsService,
    @Inject(APPLICATION_ENVIRONMENT)
    private readonly environment: ApplicationEnvironment,
  ) {}

  @Get()
  public async list(@CurrentAuth() auth: AuthContext): Promise<Invitation[]> {
    return this.organizationsService.listInvitations(auth);
  }

  @Post(":invitationId/accept")
  public async accept(
    @Param("invitationId", ParseUUIDPipe) invitationId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<{ readonly accepted: true }> {
    const data: AcceptInvitationInput = parseBody(
      acceptInvitationSchema,
      body,
    );
    return this.organizationsService.acceptInvitation({
      invitationId,
      data,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }
}
