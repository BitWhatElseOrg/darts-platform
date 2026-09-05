import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";

import { auditEvents, players, teamPlayers, teams } from "@darts-platform/database";
import type { AddTeamMemberInput, CreateTeamInput, UpdateTeamInput } from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";

export type TeamMutationResult =
  | "ok"
  | "not-found"
  | "player-not-found"
  | "player-already-member"
  | "captain-taken";

interface TeamRow {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly shortName: string | null;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface TeamMemberRow {
  readonly teamId: string;
  readonly playerId: string;
  readonly displayName: string;
  readonly role: string;
  readonly validFrom: Date;
  readonly validTo: Date | null;
}

export interface TeamData {
  readonly team: TeamRow;
  readonly members: readonly TeamMemberRow[];
}

interface ActorInput {
  readonly organizationId: string;
  readonly auth: AuthContext;
  readonly audit: AuditContext;
}

@Injectable()
export class TeamsRepository {
  public constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
  ) {}

  public async list(organizationId: string): Promise<TeamData[]> {
    const rows = await this.databaseService.database
      .select()
      .from(teams)
      .where(eq(teams.organizationId, organizationId))
      .orderBy(asc(teams.name));
    const members = await this.loadMembers(organizationId);
    return rows.map((team) => ({
      team,
      members: members.filter((member) => member.teamId === team.id),
    }));
  }

  public async get(input: {
    readonly organizationId: string;
    readonly teamId: string;
  }): Promise<TeamData | null> {
    const [team] = await this.databaseService.database
      .select()
      .from(teams)
      .where(and(eq(teams.organizationId, input.organizationId), eq(teams.id, input.teamId)))
      .limit(1);
    if (team === undefined) return null;
    const members = await this.loadMembers(input.organizationId, input.teamId);
    return { team, members };
  }

  public create(input: ActorInput & { readonly data: CreateTeamInput }): Promise<string> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(teams)
        .values({
          organizationId: input.organizationId,
          name: input.data.name,
          shortName: input.data.shortName,
          status: "ACTIVE",
        })
        .returning();
      if (created === undefined) throw new Error("Team insert did not return a row.");
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.auth.user.id,
        action: "TEAM_CREATED",
        entityType: "Team",
        entityId: created.id,
        newValue: created,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return created.id;
    });
  }

  public update(
    input: ActorInput & { readonly teamId: string; readonly data: UpdateTeamInput },
  ): Promise<TeamMutationResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(teams)
        .where(and(eq(teams.organizationId, input.organizationId), eq(teams.id, input.teamId)))
        .for("update")
        .limit(1);
      if (existing === undefined) return "not-found";
      const [updated] = await transaction
        .update(teams)
        .set({
          ...(input.data.name === undefined ? {} : { name: input.data.name }),
          ...(input.data.shortName === undefined ? {} : { shortName: input.data.shortName }),
          ...(input.data.status === undefined ? {} : { status: input.data.status }),
          updatedAt: new Date(),
        })
        .where(and(eq(teams.organizationId, input.organizationId), eq(teams.id, input.teamId)))
        .returning();
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.auth.user.id,
        action: "TEAM_UPDATED",
        entityType: "Team",
        entityId: input.teamId,
        oldValue: existing,
        newValue: updated ?? null,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return "ok";
    });
  }

  public addMember(
    input: ActorInput & { readonly teamId: string; readonly data: AddTeamMemberInput },
  ): Promise<TeamMutationResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [team] = await transaction
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.organizationId, input.organizationId), eq(teams.id, input.teamId)))
        .for("update")
        .limit(1);
      if (team === undefined) return "not-found";
      const [player] = await transaction
        .select({ id: players.id })
        .from(players)
        .where(
          and(
            eq(players.organizationId, input.organizationId),
            eq(players.id, input.data.playerId),
          ),
        )
        .limit(1);
      if (player === undefined) return "player-not-found";
      const [active] = await transaction
        .select({ id: teamPlayers.id })
        .from(teamPlayers)
        .where(
          and(
            eq(teamPlayers.organizationId, input.organizationId),
            eq(teamPlayers.teamId, input.teamId),
            eq(teamPlayers.playerId, input.data.playerId),
            isNull(teamPlayers.validTo),
          ),
        )
        .limit(1);
      if (active !== undefined) return "player-already-member";
      if (input.data.role === "CAPTAIN") {
        // Der Unique-Index deckt es ab; die Vorabfrage macht daraus eine
        // verständliche Antwort statt eines Constraint-Fehlers.
        const [captain] = await transaction
          .select({ id: teamPlayers.id })
          .from(teamPlayers)
          .where(
            and(
              eq(teamPlayers.organizationId, input.organizationId),
              eq(teamPlayers.teamId, input.teamId),
              eq(teamPlayers.role, "CAPTAIN"),
              isNull(teamPlayers.validTo),
            ),
          )
          .limit(1);
        if (captain !== undefined) return "captain-taken";
      }
      const [created] = await transaction
        .insert(teamPlayers)
        .values({
          organizationId: input.organizationId,
          teamId: input.teamId,
          playerId: input.data.playerId,
          role: input.data.role,
          ...(input.data.validFrom === undefined ? {} : { validFrom: input.data.validFrom }),
        })
        .returning();
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.auth.user.id,
        action: "TEAM_MEMBER_ADDED",
        entityType: "Team",
        entityId: input.teamId,
        newValue: created ?? null,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return "ok";
    });
  }

  /**
   * Kaderaustritte werden nie gelöscht. Eine Aufstellung wird gegen den Kader
   * zum Ansetzungszeitpunkt geprüft; ohne `valid_to` würden vergangene
   * Begegnungen nachträglich ungültig erscheinen.
   */
  public removeMember(
    input: ActorInput & { readonly teamId: string; readonly playerId: string },
  ): Promise<TeamMutationResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [membership] = await transaction
        .select()
        .from(teamPlayers)
        .where(
          and(
            eq(teamPlayers.organizationId, input.organizationId),
            eq(teamPlayers.teamId, input.teamId),
            eq(teamPlayers.playerId, input.playerId),
            isNull(teamPlayers.validTo),
          ),
        )
        .for("update")
        .limit(1);
      if (membership === undefined) return "not-found";
      const validTo = new Date();
      await transaction
        .update(teamPlayers)
        .set({
          validTo:
            validTo > membership.validFrom
              ? validTo
              : new Date(membership.validFrom.getTime() + 1),
        })
        .where(
          and(
            eq(teamPlayers.organizationId, input.organizationId),
            eq(teamPlayers.id, membership.id),
          ),
        );
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.auth.user.id,
        action: "TEAM_MEMBER_REMOVED",
        entityType: "Team",
        entityId: input.teamId,
        oldValue: membership,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return "ok";
    });
  }

  private async loadMembers(
    organizationId: string,
    teamId?: string,
  ): Promise<TeamMemberRow[]> {
    return this.databaseService.database
      .select({
        teamId: teamPlayers.teamId,
        playerId: teamPlayers.playerId,
        displayName: players.displayName,
        role: teamPlayers.role,
        validFrom: teamPlayers.validFrom,
        validTo: teamPlayers.validTo,
      })
      .from(teamPlayers)
      .innerJoin(
        players,
        and(eq(players.id, teamPlayers.playerId), eq(players.organizationId, organizationId)),
      )
      .where(
        teamId === undefined
          ? eq(teamPlayers.organizationId, organizationId)
          : and(eq(teamPlayers.organizationId, organizationId), eq(teamPlayers.teamId, teamId)),
      )
      .orderBy(asc(players.displayName), asc(teamPlayers.validFrom));
  }
}
