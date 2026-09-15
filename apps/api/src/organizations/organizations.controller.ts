import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import {
  createInvitationSchema,
  createOrganizationSchema,
  linkMemberPlayerSchema,
  updateMembershipSchema,
  type CreateInvitationInput,
  type CreateOrganizationInput,
  type CreatedInvitation,
  type LinkMemberPlayerInput,
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

  /**
   * Manuelle Zuordnung Konto -> Spielerprofil. Eigene, schmale Ressource
   * statt eines weiteren Feldes in `PATCH members/:userId`, dessen
   * Transaktion bereits Eigentumsregeln und den Schutz des letzten aktiven
   * OWNER traegt (ADR 0015).
   */
  @Put(":organizationId/members/:userId/player")
  public async linkMemberPlayer(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<OrganizationMember> {
    const data: LinkMemberPlayerInput = parseBody(linkMemberPlayerSchema, body);
    return this.organizationsService.linkMemberPlayer({
      organizationId,
      targetUserId: userId,
      data,
      auth,
      audit: getAuditContext(request),
    });
  }

  @Delete(":organizationId/members/:userId/player")
  @HttpCode(204)
  public async unlinkMemberPlayer(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.organizationsService.unlinkMemberPlayer({
      organizationId,
      targetUserId: userId,
      auth,
      audit: getAuditContext(request),
    });
  }
}
