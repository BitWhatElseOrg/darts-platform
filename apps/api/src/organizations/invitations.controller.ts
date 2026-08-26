import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import type { Invitation } from "@darts-platform/schemas";

import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { getAuditContext } from "../common/audit-context.js";
import { OrganizationsService } from "./organizations.service.js";

@Controller("invitations")
export class InvitationsController {
  public constructor(
    @Inject(OrganizationsService)
    private readonly organizationsService: OrganizationsService,
  ) {}

  @Get()
  public async list(@CurrentAuth() auth: AuthContext): Promise<Invitation[]> {
    return this.organizationsService.listInvitations(auth);
  }

  @Post(":invitationId/accept")
  public async accept(
    @Param("invitationId", ParseUUIDPipe) invitationId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<{ readonly accepted: true }> {
    return this.organizationsService.acceptInvitation({
      invitationId,
      auth,
      audit: getAuditContext(request),
    });
  }
}
