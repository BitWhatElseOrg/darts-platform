import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt } from "drizzle-orm";

import {
  auditEvents,
  memberships,
  organizationInvitations,
  organizations,
} from "@darts-platform/database";
import type {
  CreateInvitationInput,
  CreateOrganizationInput,
} from "@darts-platform/schemas";

import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";

interface ActorInput {
  readonly userId: string;
  readonly audit: AuditContext;
}

@Injectable()
export class OrganizationsRepository {
  public constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
  ) {}

  public async listForUser(userId: string) {
    return this.databaseService.database
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        timezone: organizations.timezone,
        locale: organizations.locale,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(memberships.organizationId, organizations.id),
      )
      .where(
        and(eq(memberships.userId, userId), eq(memberships.status, "ACTIVE")),
      )
      .orderBy(organizations.name);
  }

  public async getActiveMembership(input: {
    readonly organizationId: string;
    readonly userId: string;
  }) {
    const [membership] = await this.databaseService.database
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, input.organizationId),
          eq(memberships.userId, input.userId),
          eq(memberships.status, "ACTIVE"),
        ),
      )
      .limit(1);

    return membership ?? null;
  }

  public async create(
    input: CreateOrganizationInput & ActorInput,
  ) {
    return this.databaseService.database.transaction(async (transaction) => {
      const [organization] = await transaction
        .insert(organizations)
        .values({
          name: input.name,
          slug: input.slug,
          timezone: input.timezone,
          locale: input.locale,
        })
        .returning();

      if (organization === undefined) {
        throw new Error("Organization insert did not return a row.");
      }

      await transaction.insert(memberships).values({
        organizationId: organization.id,
        userId: input.userId,
        role: "OWNER",
        status: "ACTIVE",
      });

      await transaction.insert(auditEvents).values({
        organizationId: organization.id,
        actorUserId: input.userId,
        action: "ORGANIZATION_CREATED",
        entityType: "Organization",
        entityId: organization.id,
        newValue: {
          name: organization.name,
          slug: organization.slug,
        },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });

      return { ...organization, role: "OWNER" as const };
    });
  }

  public async createInvitation(
    input: CreateInvitationInput &
      ActorInput & { readonly organizationId: string },
  ) {
    return this.databaseService.database.transaction(async (transaction) => {
      await transaction
        .update(organizationInvitations)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(
          and(
            eq(organizationInvitations.organizationId, input.organizationId),
            eq(organizationInvitations.email, input.email),
            eq(organizationInvitations.status, "PENDING"),
          ),
        );

      const [invitation] = await transaction
        .insert(organizationInvitations)
        .values({
          organizationId: input.organizationId,
          email: input.email,
          role: input.role,
          invitedByUserId: input.userId,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 48),
        })
        .returning();

      if (invitation === undefined) {
        throw new Error("Invitation insert did not return a row.");
      }

      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "MEMBER_INVITED",
        entityType: "OrganizationInvitation",
        entityId: invitation.id,
        newValue: { email: invitation.email, role: invitation.role },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });

      return invitation;
    });
  }

  public async listPendingInvitations(email: string) {
    return this.databaseService.database
      .select({
        id: organizationInvitations.id,
        organizationId: organizationInvitations.organizationId,
        organizationName: organizations.name,
        email: organizationInvitations.email,
        role: organizationInvitations.role,
        status: organizationInvitations.status,
        expiresAt: organizationInvitations.expiresAt,
      })
      .from(organizationInvitations)
      .innerJoin(
        organizations,
        eq(organizationInvitations.organizationId, organizations.id),
      )
      .where(
        and(
          eq(organizationInvitations.email, email),
          eq(organizationInvitations.status, "PENDING"),
          gt(organizationInvitations.expiresAt, new Date()),
        ),
      )
      .orderBy(organizationInvitations.createdAt);
  }

  public async acceptInvitation(input: {
    readonly invitationId: string;
    readonly userId: string;
    readonly email: string;
    readonly audit: AuditContext;
  }) {
    return this.databaseService.database.transaction(async (transaction) => {
      const [invitation] = await transaction
        .select()
        .from(organizationInvitations)
        .where(
          and(
            eq(organizationInvitations.id, input.invitationId),
            eq(organizationInvitations.email, input.email),
            eq(organizationInvitations.status, "PENDING"),
            gt(organizationInvitations.expiresAt, new Date()),
          ),
        )
        .limit(1);

      if (invitation === undefined) {
        return null;
      }

      await transaction
        .insert(memberships)
        .values({
          organizationId: invitation.organizationId,
          userId: input.userId,
          role: invitation.role,
          status: "ACTIVE",
        })
        .onConflictDoUpdate({
          target: [memberships.organizationId, memberships.userId],
          set: { role: invitation.role, status: "ACTIVE" },
        });

      await transaction
        .update(organizationInvitations)
        .set({ status: "ACCEPTED", updatedAt: new Date() })
        .where(eq(organizationInvitations.id, invitation.id));

      await transaction.insert(auditEvents).values({
        organizationId: invitation.organizationId,
        actorUserId: input.userId,
        action: "MEMBER_INVITATION_ACCEPTED",
        entityType: "OrganizationInvitation",
        entityId: invitation.id,
        newValue: { role: invitation.role },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });

      return invitation;
    });
  }
}
