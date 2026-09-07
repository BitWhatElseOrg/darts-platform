import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, ne } from "drizzle-orm";

import {
  auditEvents,
  memberships,
  organizationInvitations,
  organizations,
  users,
} from "@darts-platform/database";
import {
  isMembershipStatus,
  isOrganizationRole,
  type MembershipStatus,
  type OrganizationRole,
} from "@darts-platform/domain";
import {
  organizationMemberSchema,
  type CreateInvitationInput,
  type CreateOrganizationInput,
  type OrganizationMember,
} from "@darts-platform/schemas";

import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";
import {
  generateInvitationClaimToken,
  hashInvitationClaimToken,
} from "../auth/invitation-claim.js";

export type UpdateMembershipResult =
  | { readonly outcome: "updated"; readonly member: OrganizationMember }
  | { readonly outcome: "not-found" }
  | { readonly outcome: "last-owner" }
  | { readonly outcome: "actor-not-active" }
  | { readonly outcome: "owner-grant-requires-owner" }
  | { readonly outcome: "owner-change-requires-owner" };

export type AcceptInvitationResult =
  | { readonly outcome: "accepted" }
  | { readonly outcome: "not-found" }
  | { readonly outcome: "membership-suspended" };

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
    const claimToken = generateInvitationClaimToken();
    const claimTokenHash = hashInvitationClaimToken(claimToken);

    return this.databaseService.database.transaction(async (transaction) => {
      await transaction
        .update(organizationInvitations)
        .set({
          status: "CANCELLED",
          claimTokenHash: null,
          updatedAt: new Date(),
        })
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
          claimTokenHash,
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

      return { ...invitation, claimToken };
    });
  }

  /**
   * Alle Mitgliedschaften einer Organisation, aktive wie gesperrte — die
   * Verwaltung muss auch die sehen, die sie reaktivieren soll. Der
   * Organisationsfilter steht im `WHERE`, nicht im Aufrufer (AGENTS.md §14).
   */
  public async listMembers(input: { readonly organizationId: string }) {
    return this.databaseService.database
      .select({
        userId: memberships.userId,
        email: users.email,
        displayName: users.displayName,
        role: memberships.role,
        status: memberships.status,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.organizationId, input.organizationId))
      .orderBy(users.displayName);
  }

  /**
   * Die offenen Einladungen EINER Organisation — Gegenstueck zu
   * `listPendingInvitations`, das die Einladungen einer Person ueber alle
   * Organisationen hinweg liest. Abgelaufene bleiben aussen vor: sie sind
   * nicht mehr annehmbar, und die Verwaltung soll nicht zum Zuruecknehmen von
   * etwas auffordern, das ohnehin nicht mehr gilt.
   */
  public async listInvitationsOfOrganization(input: {
    readonly organizationId: string;
  }) {
    return this.databaseService.database
      .select({
        id: organizationInvitations.id,
        organizationId: organizationInvitations.organizationId,
        email: organizationInvitations.email,
        role: organizationInvitations.role,
        status: organizationInvitations.status,
        expiresAt: organizationInvitations.expiresAt,
      })
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, input.organizationId),
          eq(organizationInvitations.status, "PENDING"),
          gt(organizationInvitations.expiresAt, new Date()),
        ),
      )
      .orderBy(organizationInvitations.createdAt);
  }

  /**
   * Nimmt eine offene Einladung zurueck. Der Claim-Token wird dabei entwertet
   * (`claim_token_hash` auf null) — eine zurueckgezogene Einladung darf sich
   * auch mit dem verschickten Code nicht mehr annehmen lassen. Das `WHERE`
   * verlangt `PENDING`: ein zweiter Rueckzug trifft keine Zeile und meldet
   * `not-found`, statt eine angenommene Einladung nachtraeglich umzuschreiben.
   */
  public async cancelInvitation(input: {
    readonly organizationId: string;
    readonly invitationId: string;
    readonly actorUserId: string;
    readonly audit: AuditContext;
  }): Promise<"cancelled" | "not-found"> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [cancelled] = await transaction
        .update(organizationInvitations)
        .set({ status: "CANCELLED", claimTokenHash: null, updatedAt: new Date() })
        .where(
          and(
            eq(organizationInvitations.id, input.invitationId),
            eq(organizationInvitations.organizationId, input.organizationId),
            eq(organizationInvitations.status, "PENDING"),
          ),
        )
        .returning({
          id: organizationInvitations.id,
          email: organizationInvitations.email,
          role: organizationInvitations.role,
        });

      if (cancelled === undefined) return "not-found";

      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "MEMBER_INVITATION_CANCELLED",
        entityType: "OrganizationInvitation",
        entityId: cancelled.id,
        oldValue: { status: "PENDING" },
        newValue: { status: "CANCELLED", email: cancelled.email, role: cancelled.role },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });

      return "cancelled";
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

  /**
   * Nimmt eine Einladung an. Die Mitgliedschaft wird dabei angelegt, aber
   * eine bestehende nie ueberschrieben: eine gesperrte bleibt gesperrt
   * (`membership-suspended`, die Einladung bleibt offen) und die Rolle einer
   * aktiven bleibt, wie sie ist. Wer eine Rolle aendert oder eine
   * Deaktivierung aufhebt, tut das ueber `updateMembership` — dort liegen die
   * Eigentumsregeln, der Schutz des letzten OWNER und der Audit-Eintrag.
   * Eine als `INVITED` vorgemerkte Zeile ist der eine Fall, den die Annahme
   * aktiviert; genau dafuer ist sie da.
   */
  public async acceptInvitation(input: {
    readonly invitationId: string;
    readonly userId: string;
    readonly email: string;
    readonly claimToken: string;
    readonly audit: AuditContext;
  }): Promise<AcceptInvitationResult> {
    const claimTokenHash = hashInvitationClaimToken(input.claimToken);

    return this.databaseService.database.transaction(async (transaction) => {
      const [invitation] = await transaction
        .select()
        .from(organizationInvitations)
        .where(
          and(
            eq(organizationInvitations.id, input.invitationId),
            eq(organizationInvitations.email, input.email),
            eq(organizationInvitations.status, "PENDING"),
            eq(organizationInvitations.claimTokenHash, claimTokenHash),
            gt(organizationInvitations.expiresAt, new Date()),
          ),
        )
        .limit(1)
        .for("update");

      if (invitation === undefined) {
        return { outcome: "not-found" };
      }

      // Bestehende Mitgliedschaft unter der Zeilensperre lesen, bevor die
      // Einladung verbraucht wird: eine gesperrte Person soll ihren
      // Claim-Token behalten, damit die Einladung nach einer Reaktivierung
      // noch gilt. Die Reihenfolge Einladung -> Mitgliedschaft kreuzt sich
      // nicht mit `updateMembership` (Organisation -> Mitgliedschaft), es
      // entsteht kein Zyklus.
      const [existing] = await transaction
        .select({ status: memberships.status })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, invitation.organizationId),
            eq(memberships.userId, input.userId),
          ),
        )
        .limit(1)
        .for("update");

      if (existing?.status === "SUSPENDED") {
        return { outcome: "membership-suspended" };
      }

      const [claimedInvitation] = await transaction
        .update(organizationInvitations)
        .set({
          status: "ACCEPTED",
          claimTokenHash: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(organizationInvitations.id, invitation.id),
            eq(organizationInvitations.status, "PENDING"),
            eq(organizationInvitations.claimTokenHash, claimTokenHash),
          ),
        )
        .returning({ id: organizationInvitations.id });

      if (claimedInvitation === undefined) {
        return { outcome: "not-found" };
      }

      // Ob diese Annahme die Mitgliedschaft wirklich angelegt hat, sagt erst
      // die zurueckgegebene Zeile: `on conflict do nothing` schreibt nichts,
      // wenn eine gleichzeitige Transaktion schneller war.
      let created: readonly { readonly userId: string }[] = [];
      if (existing === undefined) {
        created = await transaction
          .insert(memberships)
          .values({
            organizationId: invitation.organizationId,
            userId: input.userId,
            role: invitation.role,
            status: "ACTIVE",
          })
          // Auf eine fehlende Zeile laesst sich keine Sperre nehmen: legt
          // eine gleichzeitige Transaktion die Mitgliedschaft zwischen der
          // Pruefung oben und diesem `INSERT` an, waere der Primaerschluessel
          // verletzt. Nichts zu tun ist hier richtig — die bestehende Zeile
          // bleibt unangetastet, genau wie in den beiden Faellen darunter.
          .onConflictDoNothing({
            target: [memberships.organizationId, memberships.userId],
          })
          .returning({ userId: memberships.userId });
      } else if (existing.status === "INVITED") {
        await transaction
          .update(memberships)
          .set({ role: invitation.role, status: "ACTIVE" })
          .where(
            and(
              eq(memberships.organizationId, invitation.organizationId),
              eq(memberships.userId, input.userId),
            ),
          );
      }

      // Haelt fest, ob die Annahme die Mitgliedschaft ueberhaupt angefasst
      // hat — bei einer bestehenden aktiven bleibt die Rolle der Einladung
      // ohne Wirkung, und bei einem verlorenen Wettlauf um den `INSERT`
      // ebenso.
      const membershipEffect =
        existing === undefined
          ? created.length > 0
            ? "created"
            : "unchanged"
          : existing.status === "INVITED"
            ? "activated"
            : "unchanged";

      await transaction.insert(auditEvents).values({
        organizationId: invitation.organizationId,
        actorUserId: input.userId,
        action: "MEMBER_INVITATION_ACCEPTED",
        entityType: "OrganizationInvitation",
        entityId: invitation.id,
        newValue: { role: invitation.role, membership: membershipEffect },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });

      return { outcome: "accepted" };
    });
  }

  /**
   * Setzt Rolle und/oder Status einer Mitgliedschaft. Lesen, Pruefen,
   * Schreiben und Auditieren liegen in einer Transaktion. Gesperrt wird
   * zuerst die Organisationszeile — sie serialisiert alle
   * Mitgliedschaftsaenderungen dieser Organisation — und danach die
   * Zielzeile, weil `acceptInvitation` Mitgliedschaften ohne die
   * Organisationssperre schreibt. Die Reihenfolge ist immer Organisation →
   * Zeile der handelnden Person → Zielzeile, es entsteht kein Zyklus.
   *
   * Die Rolle der handelnden Person wird hier unter der Sperre gelesen und
   * nicht vom Aufrufer uebernommen: zwischen `requirePermission` im Service
   * und dieser Transaktion kann eine andere, ebenfalls serialisierte Anfrage
   * dieselbe Person herabgestuft oder gesperrt haben.
   */
  public async updateMembership(input: {
    readonly organizationId: string;
    readonly targetUserId: string;
    readonly role?: OrganizationRole;
    readonly status?: MembershipStatus;
    readonly actorUserId: string;
    readonly audit: AuditContext;
  }): Promise<UpdateMembershipResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      // Serialisierungspunkt fuer alle Mitgliedschaftsaenderungen dieser
      // Organisation: zwei gleichzeitige Anfragen warten hier aufeinander,
      // statt beide den jeweils anderen OWNER fuer den verbleibenden zu
      // halten. Die zweite liest danach den frischen Stand und bekommt einen
      // sauberen Konflikt zurueck.
      const [organization] = await transaction
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1)
        .for("update");

      if (organization === undefined) {
        return { outcome: "not-found" };
      }

      // Massgeblich fuer beide Owner-Pruefungen ist dieser Lesevorgang, nicht
      // das Ergebnis von `requirePermission`: der Service liest die Rolle vor
      // der Transaktion, und bis hierher kann sie veraltet sein.
      const [actor] = await transaction
        .select({ role: memberships.role, status: memberships.status })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, input.organizationId),
            eq(memberships.userId, input.actorUserId),
          ),
        )
        .limit(1)
        .for("update", { of: memberships });

      if (
        actor === undefined ||
        actor.status !== "ACTIVE" ||
        !isOrganizationRole(actor.role)
      ) {
        return { outcome: "actor-not-active" };
      }

      const actorRole: OrganizationRole = actor.role;

      const [current] = await transaction
        .select({
          id: memberships.id,
          role: memberships.role,
          status: memberships.status,
          email: users.email,
          displayName: users.displayName,
        })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(
          and(
            eq(memberships.organizationId, input.organizationId),
            eq(memberships.userId, input.targetUserId),
          ),
        )
        .limit(1)
        .for("update", { of: memberships });

      if (current === undefined) {
        return { outcome: "not-found" };
      }

      if (!isOrganizationRole(current.role) || !isMembershipStatus(current.status)) {
        throw new Error("The stored membership carries an unknown role or status.");
      }

      // Eigentum vergibt nur Eigentum.
      if (input.role === "OWNER" && actorRole !== "OWNER") {
        return { outcome: "owner-grant-requires-owner" };
      }

      // Die Gegenrichtung: eine bestehende OWNER-Zeile aendert nur, wer selbst
      // aktiver OWNER ist — fuer Rolle und Status gleichermassen. Die heutige
      // Rolle der Zielperson steht erst unter der Sperre fest, deshalb liegt
      // auch diese Pruefung hier und nicht im Service.
      if (current.role === "OWNER" && actorRole !== "OWNER") {
        return { outcome: "owner-change-requires-owner" };
      }

      const nextRole: OrganizationRole = input.role ?? current.role;
      const nextStatus: MembershipStatus = input.status ?? current.status;
      const losesOwnerAccess =
        current.role === "OWNER" &&
        current.status === "ACTIVE" &&
        (nextRole !== "OWNER" || nextStatus !== "ACTIVE");

      if (losesOwnerAccess) {
        const [remainingOwner] = await transaction
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, input.organizationId),
              eq(memberships.role, "OWNER"),
              eq(memberships.status, "ACTIVE"),
              ne(memberships.userId, input.targetUserId),
            ),
          )
          .limit(1);

        if (remainingOwner === undefined) {
          return { outcome: "last-owner" };
        }
      }

      await transaction
        .update(memberships)
        .set({ role: nextRole, status: nextStatus })
        .where(
          and(
            eq(memberships.organizationId, input.organizationId),
            eq(memberships.userId, input.targetUserId),
          ),
        );

      if (nextRole !== current.role) {
        await transaction.insert(auditEvents).values({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "USER_ROLE_CHANGED",
          entityType: "Membership",
          entityId: current.id,
          oldValue: { role: current.role },
          newValue: { role: nextRole },
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
          correlationId: input.audit.correlationId,
        });
      }

      if (nextStatus !== current.status) {
        await transaction.insert(auditEvents).values({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: nextStatus === "ACTIVE" ? "MEMBER_REACTIVATED" : "MEMBER_DEACTIVATED",
          entityType: "Membership",
          entityId: current.id,
          oldValue: { status: current.status },
          newValue: { status: nextStatus },
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
          correlationId: input.audit.correlationId,
        });
      }

      // Noch innerhalb der Transaktion validiert: schlaegt das Schema fehl,
      // rollt der Schreibvorgang zurueck, statt einem bereits committeten
      // Update hinterherzulaufen.
      const member = organizationMemberSchema.parse({
        userId: input.targetUserId,
        email: current.email,
        displayName: current.displayName,
        role: nextRole,
        status: nextStatus,
      });

      return { outcome: "updated", member };
    });
  }
}
