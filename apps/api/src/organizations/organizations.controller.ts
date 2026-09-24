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

import type { ApplicationEnvironment } from "@darts-platform/config";

import {
  createInvitationSchema,
  createOrganizationSchema,
  linkMemberPlayerSchema,
  updateMembershipSchema,
  updateOrganizationSchema,
  type CreateInvitationInput,
  type CreateOrganizationInput,
  type CreatedInvitation,
  type LinkMemberPlayerInput,
  type Invitation,
  type OrganizationCapabilities,
  type OrganizationMember,
  type OrganizationSummary,
  type UpdateMembershipInput,
  type UpdateOrganizationInput,
} from "@darts-platform/schemas";

import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { getAuditContext } from "../common/audit-context.js";
import { parseBody } from "../common/parse-body.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { OrganizationsService } from "./organizations.service.js";

@Controller("organizations")
export class OrganizationsController {
  public constructor(
    @Inject(OrganizationsService)
    private readonly organizationsService: OrganizationsService,
    @Inject(APPLICATION_ENVIRONMENT)
    private readonly environment: ApplicationEnvironment,
  ) {}

  /**
   * Plattformweit, ohne Mandantenbezug. Steht bewusst vor den
   * `:organizationId`-Routen: kaeme hier je ein `@Get(":organizationId")`
   * dazu, wuerde die Reihenfolge entscheiden, ob „capabilities“ als Kennung
   * gelesen wird.
   */
  @Get("capabilities")
  public capabilities(): OrganizationCapabilities {
    return this.organizationsService.capabilities();
  }

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
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Get(":organizationId")
  public async get(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<OrganizationSummary> {
    return this.organizationsService.get({ organizationId, auth });
  }

  @Patch(":organizationId")
  public async update(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<OrganizationSummary> {
    const data: UpdateOrganizationInput = parseBody(
      updateOrganizationSchema,
      body,
    );
    return this.organizationsService.update({
      organizationId,
      data,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
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
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
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
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Post(":organizationId/invitations/:invitationId/resend")
  public async resendInvitation(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("invitationId", ParseUUIDPipe) invitationId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<CreatedInvitation> {
    return this.organizationsService.resendInvitation({
      organizationId,
      invitationId,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
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
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }

  @Delete(":organizationId/members/:userId")
  @HttpCode(204)
  public async removeMember(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.organizationsService.removeMember({
      organizationId,
      targetUserId: userId,
      auth,
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
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
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
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
      audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS),
    });
  }
}
