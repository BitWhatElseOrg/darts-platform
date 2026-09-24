import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";

import {
  auditEvents,
  emailDeliveries,
  enqueueEmailDelivery,
  memberships,
  organizationInvitations,
  organizations,
  players,
  users,
} from "@darts-platform/database";
import {
  isMembershipStatus,
  isOrganizationRole,
  type MembershipStatus,
  type OrganizationRole,
} from "@darts-platform/domain";
import {
  invitationEmailPayloadSchema,
  organizationMemberSchema,
  type CreateInvitationInput,
  type CreateOrganizationInput,
  type OrganizationMember,
  type UpdateOrganizationInput,
} from "@darts-platform/schemas";

import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";
import {
  generateInvitationClaimToken,
  hashInvitationClaimToken,
  invitationClaimMatches,
} from "../auth/invitation-claim.js";
import { describeInvitationDelivery } from "./invitation-delivery.js";
import { buildInvitationUrl } from "./invitation-link.js";

export type RemoveMembershipResult =
  | { readonly outcome: "removed" }
  | { readonly outcome: "not-found" }
  | { readonly outcome: "actor-not-active" }
  | { readonly outcome: "owner-change-requires-owner" }
  | { readonly outcome: "last-owner" };

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
  | { readonly outcome: "membership-suspended" }
  | { readonly outcome: "player-already-linked" }
  | { readonly outcome: "player-not-assignable" };

type InvitationRow = typeof organizationInvitations.$inferSelect & {
  readonly claimToken: string;
};

export type LinkMemberPlayerResult =
  | { readonly outcome: "linked"; readonly member: OrganizationMember }
  | { readonly outcome: "membership-not-found" }
  | { readonly outcome: "player-not-assignable" }
  | { readonly outcome: "player-already-linked" };

export type UnlinkMemberPlayerResult =
  | { readonly outcome: "unlinked" }
  | { readonly outcome: "membership-not-found" };

export type CreateInvitationResult =
  | { readonly outcome: "created"; readonly invitation: InvitationRow }
  | { readonly outcome: "player-not-assignable" };

export type ResendInvitationResult =
  | { readonly outcome: "resent"; readonly invitation: InvitationRow }
  | { readonly outcome: "too-soon"; readonly retryAfterSeconds: number }
  | { readonly outcome: "not-found" };

interface ActorInput {
  readonly userId: string;
  readonly audit: AuditContext;
}

type DatabaseTransaction = Parameters<
  Parameters<DatabaseService["database"]["transaction"]>[0]
>[0];

/** Gueltigkeit einer Einladung: 48 Stunden, beim erneuten Senden neu gerechnet. */
const INVITATION_LIFETIME_MS = 1000 * 60 * 60 * 48;

/**
 * Sperre zwischen zwei Rotationen: 60 Sekunden. Jedes erneute Senden macht
 * den zuvor verschickten Code ungueltig; ein Doppelklick oder ein Retry nach
 * Timeout wuerde also zwei Mails erzeugen, von denen nur die zweite noch
 * funktioniert. Massstab ist `updated_at` — die Spalte wird beim Erstellen
 * wie bei jeder Rotation gesetzt, beide Male von der Datenbankuhr.
 */
export const INVITATION_RESEND_COOLDOWN_MS = 60_000;

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
        // Das eigene Spielerprofil dieser Organisation, sofern verknuepft.
        // Der Join steht ueber beiden Spalten: ein Konto kann in mehreren
        // Organisationen je ein eigenes Profil haben (ADR 0015).
        playerId: players.id,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(memberships.organizationId, organizations.id),
      )
      .leftJoin(
        players,
        and(
          eq(players.organizationId, organizations.id),
          eq(players.userId, memberships.userId),
        ),
      )
      .where(
        and(eq(memberships.userId, userId), eq(memberships.status, "ACTIVE")),
      )
      .orderBy(organizations.name);
  }

  /**
   * Eine einzelne Organisation aus Sicht eines Mitglieds: dieselbe Zeile wie
   * in `listForUser`, eingeschraenkt auf die Organisation. Ohne aktive
   * Mitgliedschaft gibt es keine Zeile — die Berechtigung prueft der Service
   * vorher, hier steht die Organisation trotzdem im `WHERE` (AGENTS.md §14).
   */
  public async getForUser(
    input: {
      readonly organizationId: string;
      readonly userId: string;
    },
    executor: DatabaseTransaction | DatabaseService["database"] = this.databaseService.database,
  ) {
    const [organization] = await executor
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        timezone: organizations.timezone,
        locale: organizations.locale,
        role: memberships.role,
        playerId: players.id,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(memberships.organizationId, organizations.id),
      )
      .leftJoin(
        players,
        and(
          eq(players.organizationId, organizations.id),
          eq(players.userId, memberships.userId),
        ),
      )
      .where(
        and(
          eq(memberships.organizationId, input.organizationId),
          eq(memberships.userId, input.userId),
          eq(memberships.status, "ACTIVE"),
        ),
      )
      .limit(1);

    return organization ?? null;
  }

  /**
   * Stammdaten aendern. Alter und neuer Stand landen im Audit; der Slug ist
   * nicht Teil der Schreibgrenze (`updateOrganizationSchema`).
   */
  public async update(
    input: UpdateOrganizationInput &
      ActorInput & { readonly organizationId: string },
  ) {
    return this.databaseService.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select({
          name: organizations.name,
          timezone: organizations.timezone,
          locale: organizations.locale,
        })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1)
        .for("update");

      if (current === undefined) {
        return null;
      }

      const next = {
        name: input.name ?? current.name,
        timezone: input.timezone ?? current.timezone,
        locale: input.locale ?? current.locale,
      };

      await transaction
        .update(organizations)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(organizations.id, input.organizationId));

      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "ORGANIZATION_UPDATED",
        entityType: "Organization",
        entityId: input.organizationId,
        oldValue: current,
        newValue: next,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });

      // Auf derselben Verbindung lesen: die Transaktion sieht ihre eigenen
      // Schreibvorgaenge, und die Antwort kann nicht mehr an einer nach dem
      // Commit veraenderten Mitgliedschaft scheitern (Update committet,
      // Client bekaeme 404 und wiederholte die Mutation).
      return this.getForUser(
        { organizationId: input.organizationId, userId: input.userId },
        transaction,
      );
    });
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

      // Eine frisch angelegte Organisation hat noch kein Spielerprofil, an das
      // die anlegende Person gebunden waere.
      return { ...organization, role: "OWNER" as const, playerId: null };
    });
  }

  public async createInvitation(
    input: CreateInvitationInput &
      ActorInput & { readonly organizationId: string; readonly webOrigin: string },
  ): Promise<CreateInvitationResult> {
    const claimToken = generateInvitationClaimToken();
    const claimTokenHash = hashInvitationClaimToken(claimToken);

    return this.databaseService.database.transaction(async (transaction) => {
      // Der optionale Spielerbezug wird schon hier geprueft: eine Einladung,
      // die auf einen fremden, archivierten oder bereits vergebenen Spieler
      // zeigt, soll gar nicht erst entstehen. Die Organisation steht im
      // `WHERE`, nicht im Aufrufer (AGENTS.md §14).
      if (input.playerId !== undefined) {
        const [player] = await transaction
          .select({ status: players.status, userId: players.userId })
          .from(players)
          .where(
            and(
              eq(players.id, input.playerId),
              eq(players.organizationId, input.organizationId),
            ),
          )
          .limit(1);

        if (
          player === undefined ||
          player.status !== "ACTIVE" ||
          player.userId !== null
        ) {
          return { outcome: "player-not-assignable" } as const;
        }
      }

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
          expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS),
          ...(input.playerId !== undefined ? { playerId: input.playerId } : {}),
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
        newValue: {
          email: invitation.email,
          role: invitation.role,
          playerId: invitation.playerId,
        },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });

      // Versandauftrag in derselben Transaktion: Einladung und Mail
      // entstehen gemeinsam oder gar nicht (Spec 2026-09-20-email-versand).
      // Organisationsname und Name der einladenden Person werden hier
      // gelesen, damit die Mail den Stand zum Zeitpunkt der Einladung traegt.
      await this.enqueueInvitationEmail(transaction, {
        organizationId: input.organizationId,
        invitationId: invitation.id,
        recipient: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        inviterUserId: input.userId,
        claimToken,
        webOrigin: input.webOrigin,
      });

      return {
        outcome: "created",
        invitation: { ...invitation, claimToken },
      } as const;
    });
  }

  /**
   * Legt den Versandauftrag einer Einladung an. `inviterName` ist der
   * Anzeigename der handelnden Person; fehlt er, rendert das Template ohne
   * Namen.
   */
  private async enqueueInvitationEmail(
    transaction: DatabaseTransaction,
    input: {
      readonly organizationId: string;
      readonly invitationId: string;
      readonly recipient: string;
      readonly role: string;
      readonly expiresAt: Date;
      readonly inviterUserId: string;
      readonly claimToken: string;
      readonly webOrigin: string;
    },
  ): Promise<void> {
    const [organization] = await transaction
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1);
    const [inviter] = await transaction
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, input.inviterUserId))
      .limit(1);
    if (organization === undefined) {
      throw new Error("Organization vanished while creating the invitation email.");
    }

    const payload = {
      organizationName: organization.name,
      inviterName: inviter?.displayName ?? "",
      role: input.role,
      invitationUrl: buildInvitationUrl(input.webOrigin, input.invitationId, input.claimToken),
      expiresAt: input.expiresAt.toISOString(),
    };

    // Nur zur Pruefung, das Ergebnis wird verworfen: ein Payload, den der
    // Worker spaeter nicht rendern kann — leerer Organisationsname, unbekannte
    // Rolle, kaputte URL —, soll hier scheitern und die Einladung mit
    // zurueckrollen, statt still im Dead-Letter zu landen. Geschrieben wird
    // das Original: `invitationEmailPayloadSchema` macht aus `expiresAt` per
    // `z.coerce.date()` ein Date, in der Zeile muss aber der ISO-String
    // stehen, weil der Worker den Payload wieder durch dasselbe Schema gibt.
    invitationEmailPayloadSchema.parse(payload);

    await enqueueEmailDelivery(transaction, {
      kind: "INVITATION",
      recipient: input.recipient,
      organizationId: input.organizationId,
      invitationId: input.invitationId,
      payload,
    });
  }

  /**
   * Alle Mitgliedschaften einer Organisation, aktive wie gesperrte — die
   * Verwaltung muss auch die sehen, die sie reaktivieren soll. Der
   * Organisationsfilter steht im `WHERE`, nicht im Aufrufer (AGENTS.md §14).
   */
  public async listMembers(input: { readonly organizationId: string }) {
    const rows = await this.databaseService.database
      .select({
        userId: memberships.userId,
        email: users.email,
        displayName: users.displayName,
        role: memberships.role,
        status: memberships.status,
        playerId: players.id,
        playerDisplayName: players.displayName,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .leftJoin(
        players,
        and(
          eq(players.organizationId, memberships.organizationId),
          eq(players.userId, memberships.userId),
        ),
      )
      .where(eq(memberships.organizationId, input.organizationId))
      .orderBy(users.displayName);

    return rows.map((row) => ({
      userId: row.userId,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      status: row.status,
      player:
        row.playerId === null || row.playerDisplayName === null
          ? null
          : { id: row.playerId, displayName: row.playerDisplayName },
    }));
  }

  /**
   * Die offenen Einladungen EINER Organisation — Gegenstueck zu
   * `listPendingInvitations`, das die Einladungen einer Person ueber alle
   * Organisationen hinweg liest. Abgelaufene bleiben aussen vor: sie sind
   * nicht mehr annehmbar, und die Verwaltung soll nicht zum Zuruecknehmen von
   * etwas auffordern, das ohnehin nicht mehr gilt.
   *
   * Jede Einladung traegt den Zustand ihrer juengsten Zustellung. Zwei
   * Abfragen statt einer `DISTINCT ON`-CTE: die Liste ist kurz, und die
   * Reduktion auf die juengste Zeile je Einladung ist in TypeScript lesbarer
   * als in SQL.
   */
  public async listInvitationsOfOrganization(input: {
    readonly organizationId: string;
  }) {
    const invitations = await this.databaseService.database
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

    if (invitations.length === 0) return [];

    const deliveries = await this.databaseService.database
      .select({
        invitationId: emailDeliveries.invitationId,
        sentAt: emailDeliveries.sentAt,
        deadLetteredAt: emailDeliveries.deadLetteredAt,
      })
      .from(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.organizationId, input.organizationId),
          inArray(
            emailDeliveries.invitationId,
            invitations.map((invitation) => invitation.id),
          ),
        ),
      )
      .orderBy(desc(emailDeliveries.createdAt));

    const latest = new Map<string, { sentAt: Date | null; deadLetteredAt: Date | null }>();
    for (const delivery of deliveries) {
      if (delivery.invitationId !== null && !latest.has(delivery.invitationId)) {
        latest.set(delivery.invitationId, delivery);
      }
    }

    return invitations.map((invitation) => ({
      ...invitation,
      lastDelivery: describeInvitationDelivery(latest.get(invitation.id)),
    }));
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

  /**
   * Erzeugt einen neuen Code fuer eine offene Einladung und legt einen
   * neuen Versandauftrag an. Weil nur der Hash gespeichert ist, laesst sich
   * der alte Code nicht erneut versenden — er wird hier ungueltig. Der
   * Ablauf beginnt neu bei 48 Stunden. Das `WHERE` verlangt `PENDING`, die
   * Organisation und eine `updated_at` ausserhalb der Sperrfrist: eine
   * angenommene, zurueckgezogene, fremde oder eben erst rotierte Einladung
   * trifft keine Zeile. Welcher der Faelle vorliegt, klaert erst der
   * anschliessende SELECT — die Bedingungen sitzen bewusst im UPDATE, damit
   * zwei gleichzeitige Anfragen nicht beide durchkommen.
   *
   * Gerechnet wird durchgehend mit `now()`, also der Datenbankuhr: `updated_at`
   * schreibt beim Erstellen die Vorgabe der Spalte, und API und PostgreSQL
   * laufen in getrennten Containern — ein Vergleich gegen die Prozessuhr
   * verschoebe die Sperrfrist um deren Gangunterschied. `now()` ist zudem der
   * Transaktionszeitpunkt, UPDATE und SELECT sehen hier also dieselbe Uhrzeit.
   */
  public async resendInvitation(
    input: {
      readonly organizationId: string;
      readonly invitationId: string;
      readonly webOrigin: string;
    } & ActorInput,
  ): Promise<ResendInvitationResult> {
    const claimToken = generateInvitationClaimToken();
    const claimTokenHash = hashInvitationClaimToken(claimToken);
    const cooldownSeconds = INVITATION_RESEND_COOLDOWN_MS / 1000;
    const lifetimeSeconds = INVITATION_LIFETIME_MS / 1000;

    return this.databaseService.database.transaction(async (transaction) => {
      const [invitation] = await transaction
        .update(organizationInvitations)
        .set({
          claimTokenHash,
          expiresAt: sql`now() + make_interval(secs => ${lifetimeSeconds})`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(organizationInvitations.id, input.invitationId),
            eq(organizationInvitations.organizationId, input.organizationId),
            eq(organizationInvitations.status, "PENDING"),
            sql`${organizationInvitations.updatedAt} < now() - make_interval(secs => ${cooldownSeconds})`,
          ),
        )
        .returning();

      if (invitation === undefined) {
        // Offen, aber eben erst rotiert: Sperrfrist. Sonst gibt es die
        // Einladung in dieser Organisation nicht (mehr). `now()` kommt als
        // Spalte mit: `updated_at` setzt die Datenbank, also muss auch die
        // Restzeit gegen die Datenbankuhr gerechnet werden — API und
        // PostgreSQL laufen in getrennten Containern.
        const [open] = await transaction
          .select({
            updatedAt: organizationInvitations.updatedAt,
            // `mapWith` ist noetig: ein blosser Ausdruck hat keinen
            // Spaltentyp, den postgres-js kennt — `now()` kaeme sonst als
            // Zeichenkette zurueck.
            serverNow: sql<Date>`now()`.mapWith(organizationInvitations.updatedAt),
          })
          .from(organizationInvitations)
          .where(
            and(
              eq(organizationInvitations.id, input.invitationId),
              eq(organizationInvitations.organizationId, input.organizationId),
              eq(organizationInvitations.status, "PENDING"),
            ),
          );
        if (open === undefined) return { outcome: "not-found" } as const;
        const remainingMs =
          open.updatedAt.getTime() + INVITATION_RESEND_COOLDOWN_MS - open.serverNow.getTime();
        return {
          outcome: "too-soon",
          retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
        } as const;
      }

      await this.enqueueInvitationEmail(transaction, {
        organizationId: input.organizationId,
        invitationId: invitation.id,
        recipient: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        inviterUserId: input.userId,
        claimToken,
        webOrigin: input.webOrigin,
      });

      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "MEMBER_INVITATION_RESENT",
        entityType: "OrganizationInvitation",
        entityId: invitation.id,
        newValue: {
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt.toISOString(),
        },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });

      return { outcome: "resent", invitation: { ...invitation, claimToken } } as const;
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
   * Vorschau fuer die Einladungsseite. Erst wird die offene, nicht
   * abgelaufene Einladung geladen, dann der Code in konstanter Zeit gegen
   * den Hash geprueft. Jede Abweichung ergibt `null` — der Aufrufer
   * antwortet einheitlich, ohne die Ursache zu nennen.
   */
  public async previewInvitation(input: {
    readonly invitationId: string;
    readonly claimToken: string;
  }): Promise<{
    readonly organizationName: string;
    readonly role: string;
    readonly email: string;
    readonly expiresAt: Date;
  } | null> {
    const [row] = await this.databaseService.database
      .select({
        organizationName: organizations.name,
        role: organizationInvitations.role,
        email: organizationInvitations.email,
        expiresAt: organizationInvitations.expiresAt,
        claimTokenHash: organizationInvitations.claimTokenHash,
      })
      .from(organizationInvitations)
      .innerJoin(
        organizations,
        eq(organizationInvitations.organizationId, organizations.id),
      )
      .where(
        and(
          eq(organizationInvitations.id, input.invitationId),
          eq(organizationInvitations.status, "PENDING"),
          gt(organizationInvitations.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (row === undefined || !invitationClaimMatches(input.claimToken, row.claimTokenHash)) {
      return null;
    }
    // Der Hash bleibt bewusst ausserhalb der Antwort — die Felder werden
    // einzeln uebernommen statt per Rest-Destrukturierung, damit ein spaeter
    // ergaenztes Feld nicht stillschweigend nach aussen gelangt.
    return {
      organizationName: row.organizationName,
      role: row.role,
      email: row.email,
      expiresAt: row.expiresAt,
    };
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

      // Dritte und letzte Sperrstufe: Einladung -> Mitgliedschaft -> Spieler.
      // Geprueft wird VOR dem Entwerten der Einladung, damit ein Konflikt sie
      // offen laesst — derselbe Umgang wie mit einer gesperrten
      // Mitgliedschaft. Die Zeilensperre haelt bis zum `UPDATE` weiter unten.
      let playerToLink: { readonly id: string; readonly alreadyMine: boolean } | null =
        null;
      if (invitation.playerId !== null) {
        const [player] = await transaction
          .select({
            id: players.id,
            status: players.status,
            userId: players.userId,
          })
          .from(players)
          .where(
            and(
              eq(players.id, invitation.playerId),
              eq(players.organizationId, invitation.organizationId),
            ),
          )
          .limit(1)
          .for("update");

        if (player !== undefined) {
          if (player.userId !== null && player.userId !== input.userId) {
            return { outcome: "player-already-linked" };
          }
          if (player.userId === null && player.status !== "ACTIVE") {
            return { outcome: "player-not-assignable" };
          }

          // Dasselbe Konto haengt hier schon an einem anderen Profil: der
          // partielle Unique-Index wuerde es ohnehin abweisen, aber als
          // sauberer Konflikt statt als 23505.
          const [otherProfile] = await transaction
            .select({ id: players.id })
            .from(players)
            .where(
              and(
                eq(players.organizationId, invitation.organizationId),
                eq(players.userId, input.userId),
                ne(players.id, player.id),
              ),
            )
            .limit(1);

          if (otherProfile !== undefined) {
            return { outcome: "player-already-linked" };
          }

          playerToLink = { id: player.id, alreadyMine: player.userId !== null };
        }
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

      if (playerToLink !== null && !playerToLink.alreadyMine) {
        await transaction
          .update(players)
          .set({ userId: input.userId, updatedAt: new Date() })
          .where(eq(players.id, playerToLink.id));

        await transaction.insert(auditEvents).values({
          organizationId: invitation.organizationId,
          actorUserId: input.userId,
          action: "PLAYER_LINKED",
          entityType: "Player",
          entityId: playerToLink.id,
          oldValue: { userId: null },
          newValue: { userId: input.userId, via: "INVITATION" },
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
          correlationId: input.audit.correlationId,
        });
      }

      await transaction.insert(auditEvents).values({
        organizationId: invitation.organizationId,
        actorUserId: input.userId,
        action: "MEMBER_INVITATION_ACCEPTED",
        entityType: "OrganizationInvitation",
        entityId: invitation.id,
        newValue: {
          role: invitation.role,
          membership: membershipEffect,
          playerId: playerToLink?.id ?? null,
        },
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
          playerId: players.id,
          playerDisplayName: players.displayName,
        })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .leftJoin(
          players,
          and(
            eq(players.organizationId, memberships.organizationId),
            eq(players.userId, memberships.userId),
          ),
        )
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
        player:
          current.playerId === null || current.playerDisplayName === null
            ? null
            : { id: current.playerId, displayName: current.playerDisplayName },
      });

      return { outcome: "updated", member };
    });
  }

  /**
   * Entfernt eine Mitgliedschaft vollstaendig. Sperrreihenfolge und Lesen
   * der handelnden Rolle unter der Sperre wie in `updateMembership` — aus
   * denselben Gruenden: der Service liest die Rolle der handelnden Person
   * vor der Transaktion, und bis hierher kann sie veraltet sein.
   *
   * Der letzte-OWNER-Schutz ist Verteidigung in der Tiefe und heute ueber
   * den Dienst nicht erreichbar: `removeMember` entfernt nie die eigene
   * Mitgliedschaft (`SELF_MEMBERSHIP_CHANGE_FORBIDDEN`) und eine bestehende
   * OWNER-Zeile nur, wer selbst aktiver OWNER ist
   * (`owner-change-requires-owner`, gleich darunter). Die handelnde Person
   * ist damit immer ein anderer aktiver OWNER als das Ziel, sodass nach dem
   * Entfernen mindestens einer uebrig bleibt. Bleibt die Pruefung trotzdem
   * bestehen, verhindert sie, dass eine spaetere Aenderung an den beiden
   * Bedingungen den letzten OWNER stillschweigend entfernbar macht.
   *
   * Das Konto selbst bleibt bestehen — nur die Mitgliedschaft und eine
   * bestehende Spielerzuordnung in dieser Organisation werden geloest, damit
   * dieselbe Person spaeter erneut eingeladen werden kann.
   */
  public async removeMembership(input: {
    readonly organizationId: string;
    readonly targetUserId: string;
    readonly actorUserId: string;
    readonly audit: AuditContext;
  }): Promise<RemoveMembershipResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [organization] = await transaction
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1)
        .for("update");

      if (organization === undefined) {
        return { outcome: "not-found" };
      }

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

      // Dieselbe Gegenrichtung wie in `updateMembership`: eine bestehende
      // OWNER-Zeile aendert (und entfernt) nur, wer selbst aktiver OWNER ist.
      if (current.role === "OWNER" && actorRole !== "OWNER") {
        return { outcome: "owner-change-requires-owner" };
      }

      // Verteidigung in der Tiefe, siehe Docstring: ueber den Dienst nicht
      // erreichbar, weil die handelnde Person hier immer ein anderer aktiver
      // OWNER als das Ziel ist.
      if (current.role === "OWNER" && current.status === "ACTIVE") {
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

      const [linked] = await transaction
        .update(players)
        .set({ userId: null, updatedAt: new Date() })
        .where(and(eq(players.organizationId, input.organizationId), eq(players.userId, input.targetUserId)))
        .returning({ id: players.id });

      if (linked !== undefined) {
        await transaction.insert(auditEvents).values({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "PLAYER_UNLINKED",
          entityType: "Player",
          entityId: linked.id,
          oldValue: { userId: input.targetUserId },
          newValue: { userId: null, reason: "MEMBER_REMOVED" },
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
          correlationId: input.audit.correlationId,
        });
      }

      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "MEMBER_REMOVED",
        entityType: "Membership",
        entityId: current.id,
        oldValue: { userId: input.targetUserId, email: current.email, role: current.role, status: current.status },
        newValue: null,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });

      await transaction
        .delete(memberships)
        .where(and(eq(memberships.organizationId, input.organizationId), eq(memberships.userId, input.targetUserId)));

      return { outcome: "removed" };
    });
  }

  /**
   * Ordnet einem Mitglied ein Spielerprofil zu. Sperrreihenfolge Organisation
   * -> Mitgliedschaft -> Spieler, dieselbe wie in `updateMembership` und
   * `acceptInvitation`, damit kein Zyklus entsteht (ADR 0015).
   *
   * Eine bestehende Zuordnung desselben Kontos auf ein anderes Profil wird in
   * derselben Transaktion geloest und neu gesetzt: ein Umhaengen soll nicht
   * am eigenen Altbestand scheitern.
   */
  public async linkMemberPlayer(input: {
    readonly organizationId: string;
    readonly targetUserId: string;
    readonly playerId: string;
    readonly actorUserId: string;
    readonly audit: AuditContext;
  }): Promise<LinkMemberPlayerResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      await transaction
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1)
        .for("update");

      const [member] = await transaction
        .select({
          userId: memberships.userId,
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

      if (member === undefined) {
        return { outcome: "membership-not-found" };
      }

      const [player] = await transaction
        .select({
          id: players.id,
          displayName: players.displayName,
          status: players.status,
          userId: players.userId,
        })
        .from(players)
        .where(
          and(
            eq(players.id, input.playerId),
            eq(players.organizationId, input.organizationId),
          ),
        )
        .limit(1)
        .for("update");

      if (player === undefined || player.status !== "ACTIVE") {
        return { outcome: "player-not-assignable" };
      }
      if (player.userId !== null && player.userId !== input.targetUserId) {
        return { outcome: "player-already-linked" };
      }

      const [previous] = await transaction
        .select({ id: players.id, displayName: players.displayName })
        .from(players)
        .where(
          and(
            eq(players.organizationId, input.organizationId),
            eq(players.userId, input.targetUserId),
            ne(players.id, player.id),
          ),
        )
        .limit(1)
        .for("update");

      if (previous !== undefined) {
        await transaction
          .update(players)
          .set({ userId: null, updatedAt: new Date() })
          .where(eq(players.id, previous.id));

        await transaction.insert(auditEvents).values({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "PLAYER_UNLINKED",
          entityType: "Player",
          entityId: previous.id,
          oldValue: { userId: input.targetUserId },
          newValue: { userId: null, reason: "RELINKED" },
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
          correlationId: input.audit.correlationId,
        });
      }

      if (player.userId === null) {
        await transaction
          .update(players)
          .set({ userId: input.targetUserId, updatedAt: new Date() })
          .where(eq(players.id, player.id));

        await transaction.insert(auditEvents).values({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "PLAYER_LINKED",
          entityType: "Player",
          entityId: player.id,
          oldValue: { userId: null },
          newValue: { userId: input.targetUserId, via: "MANUAL" },
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
          correlationId: input.audit.correlationId,
        });
      }

      return {
        outcome: "linked",
        member: organizationMemberSchema.parse({
          userId: member.userId,
          email: member.email,
          displayName: member.displayName,
          role: member.role,
          status: member.status,
          player: { id: player.id, displayName: player.displayName },
        }),
      };
    });
  }

  /**
   * Loest die Zuordnung. Idempotent: ohne bestehende Zuordnung passiert
   * nichts, und es entsteht auch kein Audit-Eintrag ueber ein Nichtereignis.
   */
  public async unlinkMemberPlayer(input: {
    readonly organizationId: string;
    readonly targetUserId: string;
    readonly actorUserId: string;
    readonly audit: AuditContext;
  }): Promise<UnlinkMemberPlayerResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      await transaction
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1)
        .for("update");

      const [member] = await transaction
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, input.organizationId),
            eq(memberships.userId, input.targetUserId),
          ),
        )
        .limit(1)
        .for("update");

      if (member === undefined) {
        return { outcome: "membership-not-found" };
      }

      const [linked] = await transaction
        .update(players)
        .set({ userId: null, updatedAt: new Date() })
        .where(
          and(
            eq(players.organizationId, input.organizationId),
            eq(players.userId, input.targetUserId),
          ),
        )
        .returning({ id: players.id });

      if (linked !== undefined) {
        await transaction.insert(auditEvents).values({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "PLAYER_UNLINKED",
          entityType: "Player",
          entityId: linked.id,
          oldValue: { userId: input.targetUserId },
          newValue: { userId: null, reason: "MANUAL" },
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
          correlationId: input.audit.correlationId,
        });
      }

      return { outcome: "unlinked" };
    });
  }
}
