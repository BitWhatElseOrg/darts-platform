import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";

import type { ApplicationEnvironment } from "@darts-platform/config";

import {
  createdInvitationSchema,
  invitationListSchema,
  organizationListSchema,
  organizationMemberListSchema,
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

    const result = await this.organizationsRepository.createInvitation({
      ...input.data,
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      audit: input.audit,
    });

    if (result.outcome === "player-not-assignable") {
      throw new UnprocessableEntityException({
        code: "PLAYER_NOT_ASSIGNABLE",
        message:
          "The player does not belong to this organization, is archived, or is already linked to an account.",
      });
    }

    return createdInvitationSchema.parse(result.invitation);
  }

  /**
   * Die Mitglieder einer Organisation. Wer Mitglieder verwalten darf, darf sie
   * auch sehen — dieselbe Berechtigung wie beim Einladen; die Rollenaenderung
   * verlangt darueber hinaus `organization:manage_roles`.
   */
  public async listMembers(input: {
    readonly organizationId: string;
    readonly auth: AuthContext;
  }): Promise<OrganizationMember[]> {
    await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "organization:manage_members",
    });

    const members = await this.organizationsRepository.listMembers({
      organizationId: input.organizationId,
    });
    return organizationMemberListSchema.parse(members);
  }

  /** Die offenen Einladungen einer Organisation. */
  public async listOrganizationInvitations(input: {
    readonly organizationId: string;
    readonly auth: AuthContext;
  }): Promise<Invitation[]> {
    await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "organization:manage_members",
    });

    const invitations =
      await this.organizationsRepository.listInvitationsOfOrganization({
        organizationId: input.organizationId,
      });
    return invitationListSchema.parse(invitations);
  }

  /**
   * Nimmt eine offene Einladung zurueck. `not-found` deckt beides ab: eine
   * fremde Einladungskennung und eine, die nicht mehr offen ist — beides
   * unterscheidet der Aufrufer nicht, und beides ist fuer ihn dasselbe.
   */
  public async cancelInvitation(input: {
    readonly organizationId: string;
    readonly invitationId: string;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<{ readonly cancelled: true }> {
    await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "organization:manage_members",
    });

    const outcome = await this.organizationsRepository.cancelInvitation({
      organizationId: input.organizationId,
      invitationId: input.invitationId,
      actorUserId: input.auth.user.id,
      audit: input.audit,
    });

    if (outcome === "not-found") {
      throw new NotFoundException(
        "This invitation does not exist or is no longer open.",
      );
    }
    return { cancelled: true };
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
    const result = await this.organizationsRepository.acceptInvitation({
      invitationId: input.invitationId,
      userId: input.auth.user.id,
      email: input.auth.user.email.toLowerCase(),
      claimToken: input.data.claimToken,
      audit: input.audit,
    });

    switch (result.outcome) {
      case "not-found":
        throw new NotFoundException(
          "The invitation does not exist, has expired, or belongs to another user.",
        );
      case "membership-suspended":
        // Eine Einladung hebt keine Deaktivierung auf; das bleibt
        // `updateMembership` mit seinen Eigentumsregeln vorbehalten. Die
        // Einladung selbst bleibt offen und gilt nach der Reaktivierung.
        throw new ConflictException({
          code: "MEMBERSHIP_SUSPENDED",
          message:
            "This membership is deactivated. An owner has to reactivate it before the invitation can be accepted.",
        });
      case "player-already-linked":
        // Zwischen Einladen und Annehmen liegen Tage. Wer hier stillschweigend
        // ohne Verknuepfung durchliefe, merkte nie, dass die Identitaet fehlt
        // oder einer anderen Person gehoert. Die Einladung bleibt offen.
        throw new ConflictException({
          code: "PLAYER_ALREADY_LINKED",
          message:
            "The player profile of this invitation is already linked to another account.",
        });
      case "player-not-assignable":
        throw new ConflictException({
          code: "PLAYER_NOT_ASSIGNABLE",
          message:
            "The player profile of this invitation is no longer available for linking.",
        });
      case "accepted":
        return { accepted: true };
    }
  }

  public async updateMembership(input: {
    readonly organizationId: string;
    readonly targetUserId: string;
    readonly data: UpdateMembershipInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<OrganizationMember> {
    // Prueft die Berechtigung; die zurueckgegebene Rolle wird hier bewusst
    // nicht weiterverwendet. Beide Owner-Pruefungen brauchen einen Stand, der
    // sich bis zum Schreibvorgang nicht mehr aendern kann — den liest das
    // Repository unter der Organisationssperre.
    await this.organizationAccessService.requirePermission({
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

    // Beide Eigentumsregeln — `OWNER` vergeben und eine bestehende OWNER-Zeile
    // aendern — liegen im Repository, weil erst dort unter der Sperre
    // feststeht, welche Rolle die handelnde Person und die Zielperson im
    // Moment des Schreibens wirklich tragen. `ADMIN` traegt zwar
    // `organization:manage_roles` und darf jede andere Rolle setzen, aber kein
    // Eigentum. Die Uebertragung unter OWNERn bleibt moeglich — sonst waere ein
    // Vorstandswechsel nur noch mit einem manuellen UPDATE auf der
    // Produktionsdatenbank machbar (AGENTS.md §21).
    const result = await this.organizationsRepository.updateMembership({
      organizationId: input.organizationId,
      targetUserId: input.targetUserId,
      actorUserId: input.auth.user.id,
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
      case "actor-not-active":
        // Die Mitgliedschaft der handelnden Person wurde zwischen der
        // Berechtigungspruefung und der Sperre entzogen oder herabgestuft.
        // Antwort wie bei `requirePermission`: 403 `PERMISSION_DENIED`.
        throw new ForbiddenException(
          "You do not have permission to access this organization resource.",
        );
      case "owner-grant-requires-owner":
        throw new ForbiddenException({
          code: "OWNER_GRANT_REQUIRES_OWNER",
          message: "Only an active owner can grant the owner role.",
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
