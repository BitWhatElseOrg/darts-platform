import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { auditEvents, boards } from "@darts-platform/database";
import { boardListSchema, boardSchema, type BoardResponse, type CreateBoardInput } from "@darts-platform/schemas";
import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { isBoardNameConflict } from "./board-occupancy.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";

@Injectable()
export class BoardsService {
  public constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(OrganizationAccessService) private readonly access: OrganizationAccessService,
  ) {}

  public async list(input: { readonly organizationId: string; readonly auth: AuthContext }): Promise<BoardResponse[]> {
    await this.access.requirePermission({ organizationId: input.organizationId, userId: input.auth.user.id, permission: "board:read" });
    return boardListSchema.parse(await this.databaseService.database.select().from(boards).where(eq(boards.organizationId, input.organizationId)).orderBy(boards.name));
  }

  public async create(input: { readonly organizationId: string; readonly auth: AuthContext; readonly audit: AuditContext; readonly data: CreateBoardInput }): Promise<BoardResponse> {
    await this.access.requirePermission({ organizationId: input.organizationId, userId: input.auth.user.id, permission: "board:manage" });
    try {
      const board = await this.databaseService.database.transaction(async (transaction) => {
        const [created] = await transaction.insert(boards).values({ organizationId: input.organizationId, name: input.data.name }).returning();
        if (created === undefined) throw new Error("Board insert did not return a row.");
        await transaction.insert(auditEvents).values({ organizationId: input.organizationId, actorUserId: input.auth.user.id, action: "BOARD_CREATED", entityType: "Board", entityId: created.id, newValue: created, ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId });
        return created;
      });
      return boardSchema.parse(board);
    } catch (error) {
      if (isBoardNameConflict(error)) {
        throw new ConflictException({ code: "BOARD_NAME_TAKEN", message: "A board with this name already exists." });
      }
      throw error;
    }
  }
}
