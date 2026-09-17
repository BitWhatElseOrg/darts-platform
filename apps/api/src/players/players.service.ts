import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";

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
import { AvatarImageError, normalizeAvatarImage } from "./avatar-image.js";
import { PlayersRepository } from "./players.repository.js";

/** Antwort auf `GET .../avatar`: Bytes plus die Metadaten fuer die Header. */
export interface PlayerAvatarResponse {
  readonly bytes: Buffer;
  readonly contentType: string;
  readonly checksum: string;
}

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

  /**
   * Lesen braucht `player:read`. Schreiben braucht `player:update` — oder die
   * Person pflegt ihr eigenes Profil (ADR 0015). Die Mitgliedschaft wird in
   * beiden Fällen geprüft, deshalb steht `player:read` zuerst.
   */
  private async requireAvatarWrite(input: {
    readonly organizationId: string;
    readonly playerId: string;
    readonly auth: AuthContext;
  }): Promise<void> {
    await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "player:read",
    });
    const player = await this.playersRepository.get({
      organizationId: input.organizationId,
      playerId: input.playerId,
    });
    if (player === null) throw new NotFoundException("Player not found.");
    if (
      await this.playersRepository.isLinkedToUser({
        organizationId: input.organizationId,
        playerId: input.playerId,
        userId: input.auth.user.id,
      })
    ) {
      return;
    }
    await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "player:update",
    });
  }

  public async getAvatar(input: {
    readonly organizationId: string;
    readonly playerId: string;
    readonly auth: AuthContext;
  }): Promise<PlayerAvatarResponse> {
    await this.organizationAccessService.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "player:read",
    });
    const player = await this.playersRepository.get({
      organizationId: input.organizationId,
      playerId: input.playerId,
    });
    if (player === null) {
      throw new NotFoundException("Player not found.");
    }
    const avatar = await this.playersRepository.findAvatar({
      organizationId: input.organizationId,
      playerId: input.playerId,
    });
    if (avatar === null) {
      throw new NotFoundException("Player has no avatar.");
    }
    return avatar;
  }

  public async setAvatar(input: {
    readonly organizationId: string;
    readonly playerId: string;
    readonly body: Buffer;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<PlayerResponse> {
    await this.requireAvatarWrite(input);

    let normalized;
    try {
      normalized = await normalizeAvatarImage(input.body);
    } catch (error: unknown) {
      if (error instanceof AvatarImageError) {
        // Die rohe `sharp`-Meldung geht nie an den Client (AGENTS.md §15).
        throw new UnprocessableEntityException({
          code: "AVATAR_INVALID_IMAGE",
          message: "Die Datei liess sich nicht als Bild lesen.",
        });
      }
      throw error;
    }

    await this.playersRepository.upsertAvatar({
      organizationId: input.organizationId,
      playerId: input.playerId,
      avatar: normalized,
      actorUserId: input.auth.user.id,
      audit: input.audit,
    });

    const player = await this.playersRepository.get({
      organizationId: input.organizationId,
      playerId: input.playerId,
    });
    if (player === null) {
      throw new NotFoundException("Player not found.");
    }
    return playerSchema.parse(player);
  }

  public async removeAvatar(input: {
    readonly organizationId: string;
    readonly playerId: string;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<PlayerResponse> {
    await this.requireAvatarWrite(input);

    await this.playersRepository.deleteAvatar({
      organizationId: input.organizationId,
      playerId: input.playerId,
      actorUserId: input.auth.user.id,
      audit: input.audit,
    });

    const player = await this.playersRepository.get({
      organizationId: input.organizationId,
      playerId: input.playerId,
    });
    if (player === null) {
      throw new NotFoundException("Player not found.");
    }
    return playerSchema.parse(player);
  }
}
