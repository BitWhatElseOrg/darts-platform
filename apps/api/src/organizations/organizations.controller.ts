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
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import {
  createInvitationSchema,
  createOrganizationSchema,
  updateMembershipSchema,
  type CreateInvitationInput,
  type CreateOrganizationInput,
  type CreatedInvitation,
  type Invitation,
  type OrganizationMember,
  type OrganizationSummary,
  type UpdateMembershipInput,
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

  @Get(":organizationId/members")
  public async listMembers(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<OrganizationMember[]> {
    return this.organizationsService.listMembers({ organizationId, auth });
  }

  @Get(":organizationId/invitations")
  public async listInvitations(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Invitation[]> {
    return this.organizationsService.listOrganizationInvitations({
      organizationId,
      auth,
    });
  }

  @Delete(":organizationId/invitations/:invitationId")
  public async cancelInvitation(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("invitationId", ParseUUIDPipe) invitationId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<{ readonly cancelled: true }> {
    return this.organizationsService.cancelInvitation({
      organizationId,
      invitationId,
      auth,
      audit: getAuditContext(request),
    });
  }

  @Patch(":organizationId/members/:userId")
  public async updateMember(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<OrganizationMember> {
    const data: UpdateMembershipInput = parseBody(updateMembershipSchema, body);
    return this.organizationsService.updateMembership({
      organizationId,
      targetUserId: userId,
      data,
      auth,
      audit: getAuditContext(request),
    });
  }
}
