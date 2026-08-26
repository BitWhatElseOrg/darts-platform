import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { auditEvents, players } from "@darts-platform/database";
import type {
  CreatePlayerInput,
  UpdatePlayerInput,
} from "@darts-platform/schemas";

import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";

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
    return this.databaseService.database
      .select()
      .from(players)
      .where(eq(players.organizationId, organizationId))
      .orderBy(players.displayName);
  }

  public async get(input: {
    readonly organizationId: string;
    readonly playerId: string;
  }) {
    const [player] = await this.databaseService.database
      .select()
      .from(players)
      .where(
        and(
          eq(players.organizationId, input.organizationId),
          eq(players.id, input.playerId),
        ),
      )
      .limit(1);

    return player ?? null;
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

      return player;
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

      return player;
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

      return player;
    });
  }
}
