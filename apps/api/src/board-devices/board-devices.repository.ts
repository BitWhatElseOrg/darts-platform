import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { boardDevices, boards, matches, organizations } from "@darts-platform/database";
import type { BoardDeviceSelf } from "@darts-platform/schemas";

import type { AuthenticatedDevice } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";

@Injectable()
export class BoardDevicesRepository {
  public constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

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
