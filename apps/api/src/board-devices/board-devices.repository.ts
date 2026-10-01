import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import { auditEvents, boardDevices, boards, matches, organizations, type BoardDevice } from "@darts-platform/database";
import type { BoardDeviceSelf } from "@darts-platform/schemas";

import type { AuthenticatedDevice } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";

@Injectable()
export class BoardDevicesRepository {
  public constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  /**
   * Nur eine Scheibe darf zeitgleich ein aktives Geraet haben
   * (`board_devices_board_active_unique`). Ein erneutes Einrichten widerruft
   * das bisherige Geraet darum in derselben Transaktion, statt den
   * Unique-Constraint scheitern zu lassen -- beide Aenderungen (Widerruf und
   * Neuanlage) landen atomar oder gar nicht.
   */
  public pair(input: {
    readonly organizationId: string;
    readonly boardId: string;
    readonly label: string;
    readonly secretHash: string;
    readonly createdBy: string;
    readonly audit: AuditContext;
  }): Promise<BoardDevice | "board-not-found"> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [board] = await transaction
        .select({ id: boards.id })
        .from(boards)
        .where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, input.boardId)))
        .for("update")
        .limit(1);
      if (board === undefined) return "board-not-found";

      const replaced = await transaction
        .update(boardDevices)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(boardDevices.organizationId, input.organizationId),
          eq(boardDevices.boardId, input.boardId),
          isNull(boardDevices.revokedAt),
        ))
        .returning();
      for (const old of replaced) {
        await transaction.insert(auditEvents).values({
          organizationId: input.organizationId,
          actorUserId: input.createdBy,
          action: "BOARD_DEVICE_REVOKED",
          entityType: "BoardDevice",
          entityId: old.id,
          oldValue: { label: old.label, boardId: old.boardId },
          newValue: { revokedAt: old.revokedAt, reason: "REPLACED" },
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
          correlationId: input.audit.correlationId,
        });
      }

      const [created] = await transaction
        .insert(boardDevices)
        .values({
          organizationId: input.organizationId,
          boardId: input.boardId,
          label: input.label,
          secretHash: input.secretHash,
          createdBy: input.createdBy,
        })
        .returning();
      if (created === undefined) throw new Error("Board device insert did not return a row.");
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.createdBy,
        action: "BOARD_DEVICE_PAIRED",
        entityType: "BoardDevice",
        entityId: created.id,
        newValue: { label: created.label, boardId: created.boardId },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return created;
    });
  }

  /**
   * Widerruft idempotent: fehlt das Geraet (falsche Scheibe oder falsche
   * Organisation), `"not-found"`; ist es bereits widerrufen, `"ok"` ohne
   * weiteren Schreibvorgang und ohne zweiten Audit-Eintrag.
   */
  public revoke(input: {
    readonly organizationId: string;
    readonly boardId: string;
    readonly deviceId: string;
    readonly actorUserId: string;
    readonly audit: AuditContext;
  }): Promise<"ok" | "not-found"> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [device] = await transaction
        .select()
        .from(boardDevices)
        .where(and(
          eq(boardDevices.organizationId, input.organizationId),
          eq(boardDevices.boardId, input.boardId),
          eq(boardDevices.id, input.deviceId),
        ))
        .for("update")
        .limit(1);
      if (device === undefined) return "not-found";
      if (device.revokedAt !== null) return "ok";

      // Abschlussreview-Befund 6 (final-fix-findings.md): eine Variable statt
      // zweier unabhaengiger `new Date()` -- Zeile und Audit-`newValue`
      // trugen sonst zwei (wenn auch meist nur minimal) verschiedene
      // Zeitpunkte.
      const revokedAt = new Date();
      await transaction
        .update(boardDevices)
        .set({ revokedAt, updatedAt: revokedAt })
        .where(eq(boardDevices.id, device.id));
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "BOARD_DEVICE_REVOKED",
        entityType: "BoardDevice",
        entityId: device.id,
        oldValue: { label: device.label, boardId: device.boardId },
        newValue: { revokedAt, reason: "MANUAL" },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return "ok";
    });
  }

  public async list(organizationId: string): Promise<BoardDevice[]> {
    return this.databaseService.database
      .select()
      .from(boardDevices)
      .where(and(eq(boardDevices.organizationId, organizationId), isNull(boardDevices.revokedAt)))
      .orderBy(boardDevices.createdAt);
  }

  public async getSelf(device: AuthenticatedDevice): Promise<BoardDeviceSelf | null> {
    const database = this.databaseService.database;
    const [row] = await database
      .select({
        deviceId: boardDevices.id,
        label: boardDevices.label,
        boardId: boards.id,
        boardName: boards.name,
        organizationId: organizations.id,
        organizationName: organizations.name,
      })
      .from(boardDevices)
      .innerJoin(boards, and(eq(boards.id, boardDevices.boardId), eq(boards.organizationId, boardDevices.organizationId)))
      .innerJoin(organizations, eq(organizations.id, boardDevices.organizationId))
      .where(and(eq(boardDevices.id, device.id), eq(boardDevices.organizationId, device.organizationId)))
      .limit(1);
    if (row === undefined) return null;

    const [current] = await database
      .select({ id: matches.id })
      .from(matches)
      .where(and(
        eq(matches.organizationId, device.organizationId),
        eq(matches.boardId, device.boardId),
        eq(matches.status, "IN_PROGRESS"),
      ))
      .limit(1);

    return {
      device: { id: row.deviceId, label: row.label },
      board: { id: row.boardId, name: row.boardName },
      organization: { id: row.organizationId, name: row.organizationName },
      currentMatchId: current?.id ?? null,
    };
  }
}
