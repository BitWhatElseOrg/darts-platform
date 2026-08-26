import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import {
  playerListSchema,
  playerSchema,
  type CreatePlayerInput,
  type PlayerResponse,
  type UpdatePlayerInput,
} from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { PlayersRepository } from "./players.repository.js";

@Injectable()
export class PlayersService {
  public constructor(
    @Inject(PlayersRepository)
    private readonly playersRepository: PlayersRepository,
    @Inject(OrganizationAccessService)
    private readonly organizationAccessService: OrganizationAccessService,
  ) {}

  public async list(input: {
    readonly organizationId: string;
    readonly auth: AuthContext;
  }): Promise<PlayerResponse[]> {
    await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "player:read",
    });
    return playerListSchema.parse(
      await this.playersRepository.list(input.organizationId),
    );
  }

  public async get(input: {
    readonly organizationId: string;
    readonly playerId: string;
    readonly auth: AuthContext;
  }): Promise<PlayerResponse> {
    await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "player:read",
    });
    const player = await this.playersRepository.get(input);
    if (player === null) {
      throw new NotFoundException("Player not found.");
    }
    return playerSchema.parse(player);
  }

  public async create(input: {
    readonly organizationId: string;
    readonly data: CreatePlayerInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<PlayerResponse> {
    await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "player:create",
    });
    return playerSchema.parse(
      await this.playersRepository.create({
        organizationId: input.organizationId,
        data: input.data,
        userId: input.auth.user.id,
        audit: input.audit,
      }),
    );
  }

  public async update(input: {
    readonly organizationId: string;
    readonly playerId: string;
    readonly data: UpdatePlayerInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<PlayerResponse> {
    await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "player:update",
    });
    const player = await this.playersRepository.update({
      organizationId: input.organizationId,
      playerId: input.playerId,
      data: input.data,
      userId: input.auth.user.id,
      audit: input.audit,
    });
    if (player === null) {
      throw new NotFoundException("Player not found.");
    }
    return playerSchema.parse(player);
  }

  public async archive(input: {
    readonly organizationId: string;
    readonly playerId: string;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<PlayerResponse> {
    await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "player:archive",
    });
    const player = await this.playersRepository.archive({
      organizationId: input.organizationId,
      playerId: input.playerId,
      userId: input.auth.user.id,
      audit: input.audit,
    });
    if (player === null) {
      throw new NotFoundException("Player not found.");
    }
    return playerSchema.parse(player);
  }
}
