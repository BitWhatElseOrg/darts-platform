import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import {
  auditEvents,
  playerAvatars,
  players,
  type DatabaseExecutor,
} from "@darts-platform/database";
import type {
  CreatePlayerInput,
  UpdatePlayerInput,
} from "@darts-platform/schemas";

import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";

type PlayerRow = typeof players.$inferSelect;

/**
 * Das Lesemodell eines Spielers. `user_id` verlaesst das Repository bewusst
 * nicht: `player:read` haben auch MEMBER und VIEWER, und ueber die
 * Spielerliste sollen keine Kontoangaben abfliessen, die hinter
 * `organization:manage_members` liegen (ADR 0015). Die Felder stehen einzeln
 * da, damit eine kuenftige Spalte nicht stillschweigend mitreist.
 */
function toPlayerResponse(row: PlayerRow, avatarChecksum: string | null) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    publicId: row.publicId,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: row.displayName,
    nickname: row.nickname,
    email: row.email,
    externalReference: row.externalReference,
    status: row.status,
    hasAccount: row.userId !== null,
    avatarChecksum,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Liest ausschliesslich die Pruefsumme eines vorhandenen Profilbildes, nie
 * die Bytes selbst. Wird von den Schreibpfaden gebraucht, die den Spieler
 * nicht ueber den `leftJoin` aus `list`/`get` lesen, aber trotzdem den
 * tatsaechlichen Bildstand melden muessen (z. B. beim Archivieren eines
 * Spielers mit bestehendem Bild).
 */
async function findAvatarChecksum(
  executor: DatabaseExecutor,
  playerId: string,
): Promise<string | null> {
  const [avatar] = await executor
    .select({ checksum: playerAvatars.checksum })
    .from(playerAvatars)
    .where(eq(playerAvatars.playerId, playerId))
    .limit(1);

  return avatar?.checksum ?? null;
}

interface TenantActorInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly audit: AuditContext;
}

@Injectable()
export class PlayersRepository {
  public constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
  ) {}

  public async list(organizationId: string) {
    const rows = await this.databaseService.database
      .select({ player: players, avatarChecksum: playerAvatars.checksum })
      .from(players)
      .leftJoin(playerAvatars, eq(playerAvatars.playerId, players.id))
      .where(eq(players.organizationId, organizationId))
      .orderBy(players.displayName);

    return rows.map((row) =>
      toPlayerResponse(row.player, row.avatarChecksum ?? null),
    );
  }

  public async get(input: {
    readonly organizationId: string;
    readonly playerId: string;
  }) {
    const [row] = await this.databaseService.database
      .select({ player: players, avatarChecksum: playerAvatars.checksum })
      .from(players)
      .leftJoin(playerAvatars, eq(playerAvatars.playerId, players.id))
      .where(
        and(
          eq(players.organizationId, input.organizationId),
          eq(players.id, input.playerId),
        ),
      )
      .limit(1);

    return row === undefined
      ? null
      : toPlayerResponse(row.player, row.avatarChecksum ?? null);
  }

  public async create(
    input: TenantActorInput & { readonly data: CreatePlayerInput },
  ) {
    return this.databaseService.database.transaction(async (transaction) => {
      const [player] = await transaction
        .insert(players)
        .values({
          organizationId: input.organizationId,
          displayName: input.data.displayName,
          status: input.data.status,
          ...(input.data.firstName !== undefined
            ? { firstName: input.data.firstName }
            : {}),
          ...(input.data.lastName !== undefined
            ? { lastName: input.data.lastName }
            : {}),
          ...(input.data.nickname !== undefined
            ? { nickname: input.data.nickname }
            : {}),
          ...(input.data.email !== undefined ? { email: input.data.email } : {}),
          ...(input.data.externalReference !== undefined
            ? { externalReference: input.data.externalReference }
            : {}),
        })
        .returning();

      if (player === undefined) {
        throw new Error("Player insert did not return a row.");
      }

      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "PLAYER_CREATED",
        entityType: "Player",
        entityId: player.id,
        newValue: player,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });

      // Ein frisch angelegter Spieler kann noch kein Profilbild haben.
      return toPlayerResponse(player, null);
    });
  }

  public async update(
    input: TenantActorInput & {
      readonly playerId: string;
      readonly data: UpdatePlayerInput;
    },
  ) {
    return this.databaseService.database.transaction(async (transaction) => {
      const [previous] = await transaction
        .select()
        .from(players)
        .where(
          and(
            eq(players.organizationId, input.organizationId),
            eq(players.id, input.playerId),
          ),
        )
        .limit(1);

      if (previous === undefined) {
        return null;
      }

      const [player] = await transaction
        .update(players)
        .set({
          updatedAt: new Date(),
          ...(input.data.displayName !== undefined
            ? { displayName: input.data.displayName }
            : {}),
          ...(input.data.status !== undefined
            ? { status: input.data.status }
            : {}),
          ...(input.data.firstName !== undefined
            ? { firstName: input.data.firstName }
            : {}),
          ...(input.data.lastName !== undefined
            ? { lastName: input.data.lastName }
            : {}),
          ...(input.data.nickname !== undefined
            ? { nickname: input.data.nickname }
            : {}),
          ...(input.data.email !== undefined ? { email: input.data.email } : {}),
          ...(input.data.externalReference !== undefined
            ? { externalReference: input.data.externalReference }
            : {}),
        })
        .where(
          and(
            eq(players.organizationId, input.organizationId),
            eq(players.id, input.playerId),
          ),
        )
        .returning();

      if (player === undefined) {
        throw new Error("Player update did not return a row.");
      }

      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "PLAYER_UPDATED",
        entityType: "Player",
        entityId: player.id,
        oldValue: previous,
        newValue: player,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });

      // Das Update aendert das Profilbild nicht; die vorhandene Pruefsumme
      // (falls eine existiert) bleibt massgeblich fuer die Antwort.
      const avatarChecksum = await findAvatarChecksum(transaction, player.id);
      return toPlayerResponse(player, avatarChecksum);
    });
  }

  public async archive(
    input: TenantActorInput & { readonly playerId: string },
  ) {
    return this.databaseService.database.transaction(async (transaction) => {
      const [previous] = await transaction
        .select()
        .from(players)
        .where(
          and(
            eq(players.organizationId, input.organizationId),
            eq(players.id, input.playerId),
          ),
        )
        .limit(1);

      if (previous === undefined) {
        return null;
      }

      const [player] = await transaction
        .update(players)
        .set({ status: "INACTIVE", updatedAt: new Date() })
        .where(
          and(
            eq(players.organizationId, input.organizationId),
            eq(players.id, input.playerId),
          ),
        )
        .returning();

      if (player === undefined) {
        throw new Error("Player archive did not return a row.");
      }

      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "PLAYER_ARCHIVED",
        entityType: "Player",
        entityId: player.id,
        oldValue: previous,
        newValue: player,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });

      // Das Archivieren aendert das Profilbild nicht; die vorhandene
      // Pruefsumme (falls eine existiert) bleibt massgeblich.
      const avatarChecksum = await findAvatarChecksum(transaction, player.id);
      return toPlayerResponse(player, avatarChecksum);
    });
  }
}
