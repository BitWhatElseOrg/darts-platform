import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type { ApplicationEnvironment } from "@darts-platform/config";

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
  type OrganizationMember,
  type OrganizationSummary,
  type UpdateMembershipInput,
} from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
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
    @Inject(APPLICATION_ENVIRONMENT)
    private readonly environment: ApplicationEnvironment,
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
    // Ohne diese Sperre macht sich jede angemeldete Person zum OWNER eines
    // eigenen Mandanten und darf von dort aus beliebig einladen — die
    // einladungsgebundene Registrierung aus ADR 0010 waere damit umgangen
    // (Audit B, I-3). Mandanten entstehen ueber den Bootstrap-Pfad
    // (ADR 0012), solange es keine Systemrolle `SUPER_ADMIN` gibt.
    if (!this.environment.ALLOW_SELF_SERVICE_ORGANIZATIONS) {
      throw new ForbiddenException({
        code: "SELF_SERVICE_ORGANIZATIONS_DISABLED",
        message: "New organizations are created by platform operations.",
      });
    }

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

  public async updateMembership(input: {
    readonly organizationId: string;
    readonly targetUserId: string;
    readonly data: UpdateMembershipInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<OrganizationMember> {
    // `requirePermission` liefert die Rolle der handelnden Person zurueck —
    // die wird gleich fuer die Eigentumsuebertragung gebraucht, ohne dass
    // eine zweite Abfrage noetig waere.
    const actorRole = await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "organization:manage_roles",
    });

    // Die eigene Mitgliedschaft bleibt aussen vor. „Herabstufung“ ist im
    // Rollenmodell nicht total geordnet (SCORER und MEMBER lassen sich nicht
    // vergleichen); ein Verbot der Selbstaenderung ist dagegen exakt und
    // schliesst die Selbstaussperrung vollstaendig aus. Regel: es bleibt
    // immer ein aktiver OWNER, der die Aenderung vornehmen kann.
    if (input.targetUserId === input.auth.user.id) {
      throw new ForbiddenException({
        code: "SELF_MEMBERSHIP_CHANGE_FORBIDDEN",
        message: "Your own membership is changed by another administrator.",
      });
    }

    // Eigentum vergibt nur Eigentum. Die Gegenrichtung — eine bestehende
    // OWNER-Zeile aendern — prueft das Repository unter der Sperre
    // (`OWNER_CHANGE_REQUIRES_OWNER`), weil die heutige Rolle der Zielperson
    // erst dort feststeht. `ADMIN` traegt zwar
    // `organization:manage_roles` und darf jede andere Rolle setzen, aber
    // sich nicht selbst zum Miteigentuemer machen, indem er einen Vertrauten
    // zum OWNER ernennt. Die Uebertragung selbst bleibt moeglich — sonst
    // waere ein Vorstandswechsel nur noch mit einem manuellen UPDATE auf der
    // Produktionsdatenbank machbar (AGENTS.md §21).
    if (input.data.role === "OWNER" && actorRole !== "OWNER") {
      throw new ForbiddenException({
        code: "OWNER_GRANT_REQUIRES_OWNER",
        message: "Only an active owner can grant the owner role.",
      });
    }

    const result = await this.organizationsRepository.updateMembership({
      organizationId: input.organizationId,
      targetUserId: input.targetUserId,
      actorUserId: input.auth.user.id,
      actorRole,
      audit: input.audit,
      ...(input.data.role === undefined ? {} : { role: input.data.role }),
      ...(input.data.status === undefined ? {} : { status: input.data.status }),
    });

    switch (result.outcome) {
      case "not-found":
        throw new NotFoundException(
          "This membership does not exist in this organization.",
        );
      case "last-owner":
        throw new ConflictException({
          code: "LAST_OWNER_PROTECTED",
          message: "The last active owner cannot be demoted or deactivated.",
        });
      case "owner-change-requires-owner":
        throw new ForbiddenException({
          code: "OWNER_CHANGE_REQUIRES_OWNER",
          message: "Only an active owner can change an owner membership.",
        });
      case "updated":
        return result.member;
    }
  }
}
