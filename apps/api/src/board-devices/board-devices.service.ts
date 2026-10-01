import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { createBoardDeviceSecret, hashBoardDeviceSecret } from "@darts-platform/domain/board-device-secret";
import {
  boardDeviceListSchema,
  createdBoardDeviceSchema,
  type BoardDeviceList,
  type CreateBoardDeviceInput,
  type CreatedBoardDevice,
} from "@darts-platform/schemas";
import type { BoardDevice } from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { BoardDevicesRepository } from "./board-devices.repository.js";

function toResponse(device: BoardDevice) {
  return {
    id: device.id,
    boardId: device.boardId,
    label: device.label,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
  };
}

@Injectable()
export class BoardDevicesService {
  public constructor(
    @Inject(BoardDevicesRepository) private readonly repository: BoardDevicesRepository,
    @Inject(OrganizationAccessService) private readonly access: OrganizationAccessService,
  ) {}

  public async pair(input: {
    readonly organizationId: string;
    readonly boardId: string;
    readonly data: CreateBoardDeviceInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<CreatedBoardDevice> {
    await this.access.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "board:manage",
    });

    const secret = createBoardDeviceSecret();
    const created = await this.repository.pair({
      organizationId: input.organizationId,
      boardId: input.boardId,
      label: input.data.label,
      secretHash: hashBoardDeviceSecret(secret),
      createdBy: input.auth.user.id,
      audit: input.audit,
    });
    if (created === "board-not-found") throw new NotFoundException("Board not found.");

    return createdBoardDeviceSchema.parse({ device: toResponse(created), secret });
  }

  public async revoke(input: {
    readonly organizationId: string;
    readonly boardId: string;
    readonly deviceId: string;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<void> {
    await this.access.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "board:manage",
    });

    const result = await this.repository.revoke({
      organizationId: input.organizationId,
      boardId: input.boardId,
      deviceId: input.deviceId,
      actorUserId: input.auth.user.id,
      audit: input.audit,
    });
    if (result === "not-found") throw new NotFoundException("Board device not found.");
  }

  public async list(input: {
    readonly organizationId: string;
    readonly auth: AuthContext;
  }): Promise<BoardDeviceList> {
    await this.access.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "board:manage",
    });

    const rows = await this.repository.list(input.organizationId);
    return boardDeviceListSchema.parse(rows.map(toResponse));
  }
}
