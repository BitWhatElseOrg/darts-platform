import { Inject, Injectable } from "@nestjs/common";
import { and, eq, or } from "drizzle-orm";

import {
  auditEvents,
  encounterLineupEntries,
  encounterNominations,
  encounterSubstitutions,
  matchParticipantPlayers,
  playerAvatars,
  players,
  teamPlayers,
  tournamentGroupParticipants,
  tournamentMatches,
  tournamentParticipants,
  visits,
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
 * Kommt der Spieler in einer Tabelle vor, die ihn per RESTRICT festhaelt?
 * Sequentiell statt `Promise.all`: alle Proben laufen auf derselben
 * Transaktionsverbindung, und die erste gefundene Zeile beendet die
 * Pruefung sofort.
 */
async function hasPlayerHistory(
  executor: DatabaseExecutor,
  organizationId: string,
  playerId: string,
): Promise<boolean> {
  const probes: Array<() => Promise<{ readonly id: string }[]>> = [
    () =>
      executor
        .select({ id: matchParticipantPlayers.playerId })
        .from(matchParticipantPlayers)
        .where(
          and(
            eq(matchParticipantPlayers.organizationId, organizationId),
            eq(matchParticipantPlayers.playerId, playerId),
          ),
        )
        .limit(1),
    () =>
      executor
        .select({ id: visits.id })
        .from(visits)
        .where(
          and(
            eq(visits.organizationId, organizationId),
            eq(visits.throwerPlayerId, playerId),
          ),
        )
        .limit(1),
    () =>
      executor
        .select({ id: tournamentParticipants.playerId })
        .from(tournamentParticipants)
        .where(
          and(
            eq(tournamentParticipants.organizationId, organizationId),
            eq(tournamentParticipants.playerId, playerId),
          ),
        )
        .limit(1),
    () =>
      executor
        .select({ id: tournamentGroupParticipants.playerId })
        .from(tournamentGroupParticipants)
        .where(
          and(
            eq(tournamentGroupParticipants.organizationId, organizationId),
            eq(tournamentGroupParticipants.playerId, playerId),
          ),
        )
        .limit(1),
    () =>
      executor
        .select({ id: tournamentMatches.id })
        .from(tournamentMatches)
        .where(
          and(
            eq(tournamentMatches.organizationId, organizationId),
            or(
              eq(tournamentMatches.participantOneId, playerId),
              eq(tournamentMatches.participantTwoId, playerId),
              eq(tournamentMatches.winnerPlayerId, playerId),
            ),
          ),
        )
        .limit(1),
    () =>
      executor
        .select({ id: teamPlayers.playerId })
        .from(teamPlayers)
        .where(
          and(
            eq(teamPlayers.organizationId, organizationId),
            eq(teamPlayers.playerId, playerId),
          ),
        )
        .limit(1),
    () =>
      executor
        .select({ id: encounterNominations.playerId })
        .from(encounterNominations)
        .where(
          and(
            eq(encounterNominations.organizationId, organizationId),
            eq(encounterNominations.playerId, playerId),
          ),
        )
        .limit(1),
    () =>
      executor
        .select({ id: encounterLineupEntries.playerId })
        .from(encounterLineupEntries)
        .where(
          and(
            eq(encounterLineupEntries.organizationId, organizationId),
            eq(encounterLineupEntries.playerId, playerId),
          ),
        )
        .limit(1),
    () =>
      executor
        .select({ id: encounterSubstitutions.id })
        .from(encounterSubstitutions)
        .where(
          and(
            eq(encounterSubstitutions.organizationId, organizationId),
            or(
              eq(encounterSubstitutions.outPlayerId, playerId),
              eq(encounterSubstitutions.inPlayerId, playerId),
            ),
          ),
        )
        .limit(1),
  ];

  for (const probe of probes) {
    const rows = await probe();
    if (rows.length > 0) {
      return true;
    }
  }
  return false;
}

/** Prallt ein Schreibvorgang an einem RESTRICT-Fremdschluessel ab? */
function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23503"
  );
}

/**
 * Liest ausschliesslich die Pruefsumme eines vorhandenen Profilbildes, nie
 * die Bytes selbst. Wird von den Schreibpfaden gebraucht, die den Spieler
 * nicht ueber den `leftJoin` aus `list`/`get` lesen, aber trotzdem den
 * tatsaechlichen Bildstand melden muessen (z. B. beim Archivieren eines
 * Spielers mit bestehendem Bild). `organizationId` wird explizit mitgefuehrt
 * (AGENTS.md §14) statt sich auf die Mandantenpruefung der Aufrufer zu
 * verlassen: die Funktion bleibt auch dann sicher, wenn sie kuenftig von
 * einer Stelle aufgerufen wird, die `playerId` nicht selbst schon
 * tenant-scoped validiert hat.
 */
async function findAvatarChecksum(
  executor: DatabaseExecutor,
  organizationId: string,
  playerId: string,
): Promise<string | null> {
  const [avatar] = await executor
    .select({ checksum: playerAvatars.checksum })
    .from(playerAvatars)
    .where(
      and(
        eq(playerAvatars.organizationId, organizationId),
        eq(playerAvatars.playerId, playerId),
      ),
    )
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
      const avatarChecksum = await findAvatarChecksum(
        transaction,
        input.organizationId,
        player.id,
      );
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
      const avatarChecksum = await findAvatarChecksum(
        transaction,
        input.organizationId,
        player.id,
      );
      return toPlayerResponse(player, avatarChecksum);
    });
  }

  /**
   * Loescht einen Spieler endgueltig — nur, wenn er keine Historie hat
   * (Spec 2026-09-24-bearbeiten-loeschen). Die RESTRICT-Fremdschluessel
   * bleiben die letzte Wache; die ausdrueckliche Pruefung vorher liefert
   * eine verstaendliche Antwort statt eines Datenbankfehlers.
   */
  public async deletePermanently(
    input: TenantActorInput & { readonly playerId: string },
  ): Promise<"deleted" | "not-found" | "has-history"> {
    try {
      return await this.databaseService.database.transaction(async (transaction) => {
        const [previous] = await transaction
          .select()
          .from(players)
          .where(
            and(
              eq(players.organizationId, input.organizationId),
              eq(players.id, input.playerId),
            ),
          )
          .limit(1)
          .for("update");

        if (previous === undefined) {
          return "not-found";
        }

        if (await hasPlayerHistory(transaction, input.organizationId, input.playerId)) {
          return "has-history";
        }

        await transaction.insert(auditEvents).values({
          organizationId: input.organizationId,
          actorUserId: input.userId,
          action: "PLAYER_DELETED",
          entityType: "Player",
          entityId: previous.id,
          oldValue: previous,
          newValue: null,
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
          correlationId: input.audit.correlationId,
        });

        await transaction
          .delete(players)
          .where(
            and(
              eq(players.organizationId, input.organizationId),
              eq(players.id, input.playerId),
            ),
          );

        return "deleted";
      });
    } catch (error) {
      // Eine parallel entstandene Historie scheitert am RESTRICT-Schluessel.
      if (isForeignKeyViolation(error)) {
        return "has-history";
      }
      throw error;
    }
  }

  public async findAvatar(input: {
    readonly organizationId: string;
    readonly playerId: string;
  }): Promise<{
    readonly bytes: Buffer;
    readonly contentType: string;
    readonly checksum: string;
  } | null> {
    const [row] = await this.databaseService.database
      .select({
        bytes: playerAvatars.bytes,
        contentType: playerAvatars.contentType,
        checksum: playerAvatars.checksum,
      })
      .from(playerAvatars)
      .where(
        and(
          eq(playerAvatars.organizationId, input.organizationId),
          eq(playerAvatars.playerId, input.playerId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  public async upsertAvatar(input: {
    readonly organizationId: string;
    readonly playerId: string;
    readonly avatar: {
      readonly bytes: Buffer;
      readonly contentType: string;
      readonly checksum: string;
      readonly byteSize: number;
    };
    readonly actorUserId: string;
    readonly audit: AuditContext;
  }): Promise<void> {
    await this.databaseService.database.transaction(async (transaction) => {
      await transaction
        .insert(playerAvatars)
        .values({
          organizationId: input.organizationId,
          playerId: input.playerId,
          contentType: input.avatar.contentType,
          bytes: input.avatar.bytes,
          byteSize: input.avatar.byteSize,
          checksum: input.avatar.checksum,
        })
        .onConflictDoUpdate({
          target: playerAvatars.playerId,
          set: {
            contentType: input.avatar.contentType,
            bytes: input.avatar.bytes,
            byteSize: input.avatar.byteSize,
            checksum: input.avatar.checksum,
            updatedAt: new Date(),
          },
          // Ohne diese Bedingung würde der Konfliktzweig eine Zeile einer
          // fremden Organisation überschreiben, träfe `playerId` (die
          // Konfliktspalte) je eine solche. Dieselbe Überlegung wie bei
          // `findAvatarChecksum`: die Mandantengrenze steht nicht nur in der
          // Verantwortung der Aufrufer.
          setWhere: eq(playerAvatars.organizationId, input.organizationId),
        });
      // Die Pruefsumme, nicht die Bytes: ein Audit-Log mit Bilddaten waere
      // eine zweite, unkontrollierte Kopie der Personendaten.
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "PLAYER_AVATAR_UPDATED",
        entityType: "Player",
        entityId: input.playerId,
        newValue: { checksum: input.avatar.checksum, byteSize: input.avatar.byteSize },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
    });
  }

  public async deleteAvatar(input: {
    readonly organizationId: string;
    readonly playerId: string;
    readonly actorUserId: string;
    readonly audit: AuditContext;
  }): Promise<void> {
    await this.databaseService.database.transaction(async (transaction) => {
      const [removed] = await transaction
        .delete(playerAvatars)
        .where(
          and(
            eq(playerAvatars.organizationId, input.organizationId),
            eq(playerAvatars.playerId, input.playerId),
          ),
        )
        .returning({ checksum: playerAvatars.checksum });
      if (removed === undefined) return;
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "PLAYER_AVATAR_REMOVED",
        entityType: "Player",
        entityId: input.playerId,
        oldValue: { checksum: removed.checksum },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
    });
  }

  /**
   * Ob dieses Konto mit diesem Spieler verknuepft ist (ADR 0015): Grundlage
   * fuer die Regel „Schreiben braucht `player:update` oder das eigene
   * Profil". `organizationId` wird mitgefuehrt, damit die Prüfung auch ohne
   * vorherige Mandantenpruefung durch die Aufrufer sicher bleibt.
   */
  public async isLinkedToUser(input: {
    readonly organizationId: string;
    readonly playerId: string;
    readonly userId: string;
  }): Promise<boolean> {
    const [row] = await this.databaseService.database
      .select({ id: players.id })
      .from(players)
      .where(
        and(
          eq(players.organizationId, input.organizationId),
          eq(players.id, input.playerId),
          eq(players.userId, input.userId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }
}
