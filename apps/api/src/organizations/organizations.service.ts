import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  createdInvitationSchema,
  invitationListSchema,
  organizationListSchema,
  organizationSummarySchema,
  type AcceptInvitationInput,
  type CreateInvitationInput,
  type CreateOrganizationInput,
  type CreatedInvitation,
  type Invitation,
  type OrganizationSummary,
} from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationsRepository } from "./organizations.repository.js";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

@Injectable()
export class OrganizationsService {
  public constructor(
    @Inject(OrganizationsRepository)
    private readonly organizationsRepository: OrganizationsRepository,
    @Inject(OrganizationAccessService)
    private readonly organizationAccessService: OrganizationAccessService,
  ) {}

  public async list(auth: AuthContext): Promise<OrganizationSummary[]> {
    const organizations = await this.organizationsRepository.listForUser(
      auth.user.id,
    );
    return organizationListSchema.parse(organizations);
  }

  public async create(input: {
    readonly data: CreateOrganizationInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<OrganizationSummary> {
    try {
      const organization = await this.organizationsRepository.create({
        ...input.data,
        userId: input.auth.user.id,
        audit: input.audit,
      });
      return organizationSummarySchema.parse(organization);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("This organization slug is already used.");
      }
      throw error;
    }
  }

  public async invite(input: {
    readonly organizationId: string;
    readonly data: CreateInvitationInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<CreatedInvitation> {
    await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "organization:manage_members",
    });

    const invitation = await this.organizationsRepository.createInvitation({
      ...input.data,
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      audit: input.audit,
    });

    return createdInvitationSchema.parse(invitation);
  }

  public async listInvitations(auth: AuthContext): Promise<Invitation[]> {
    const invitations =
      await this.organizationsRepository.listPendingInvitations(
        auth.user.email.toLowerCase(),
      );
    return invitationListSchema.parse(invitations);
  }

  public async acceptInvitation(input: {
    readonly invitationId: string;
    readonly data: AcceptInvitationInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<{ readonly accepted: true }> {
    const invitation = await this.organizationsRepository.acceptInvitation({
      invitationId: input.invitationId,
      userId: input.auth.user.id,
      email: input.auth.user.email.toLowerCase(),
      claimToken: input.data.claimToken,
      audit: input.audit,
    });

    if (invitation === null) {
      throw new NotFoundException(
        "The invitation does not exist, has expired, or belongs to another user.",
      );
    }

    return { accepted: true };
  }
}
