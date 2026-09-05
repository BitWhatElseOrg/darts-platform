import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import {
  teamListSchema,
  teamSchema,
  type AddTeamMemberInput,
  type CreateTeamInput,
  type TeamResponse,
  type UpdateTeamInput,
} from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { TeamsRepository, type TeamData, type TeamMutationResult } from "./teams.repository.js";

function toResponse(data: TeamData): unknown {
  return {
    id: data.team.id,
    organizationId: data.team.organizationId,
    name: data.team.name,
    shortName: data.team.shortName,
    status: data.team.status,
    members: data.members.map((member) => ({
      playerId: member.playerId,
      displayName: member.displayName,
      role: member.role,
      validFrom: member.validFrom,
      validTo: member.validTo,
    })),
    createdAt: data.team.createdAt,
    updatedAt: data.team.updatedAt,
  };
}

@Injectable()
export class TeamsService {
  public constructor(
    @Inject(TeamsRepository) private readonly repository: TeamsRepository,
    @Inject(OrganizationAccessService) private readonly access: OrganizationAccessService,
  ) {}

  public async list(input: {
    readonly organizationId: string;
    readonly auth: AuthContext;
  }): Promise<TeamResponse[]> {
    await this.require(input, "team:read");
    return teamListSchema.parse((await this.repository.list(input.organizationId)).map(toResponse));
  }

  public async get(input: {
    readonly organizationId: string;
    readonly teamId: string;
    readonly auth: AuthContext;
  }): Promise<TeamResponse> {
    await this.require(input, "team:read");
    const data = await this.repository.get(input);
    if (data === null) throw new NotFoundException({ code: "NOT_FOUND", message: "Team not found." });
    return teamSchema.parse(toResponse(data));
  }

  public async create(input: {
    readonly organizationId: string;
    readonly data: CreateTeamInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<TeamResponse> {
    await this.require(input, "team:manage");
    const teamId = await this.repository.create(input);
    return this.get({ organizationId: input.organizationId, teamId, auth: input.auth });
  }

  public async update(input: {
    readonly organizationId: string;
    readonly teamId: string;
    readonly data: UpdateTeamInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<TeamResponse> {
    await this.require(input, "team:manage");
    this.assert(await this.repository.update(input));
    return this.get(input);
  }

  public async addMember(input: {
    readonly organizationId: string;
    readonly teamId: string;
    readonly data: AddTeamMemberInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<TeamResponse> {
    await this.require(input, "team:manage");
    this.assert(await this.repository.addMember(input));
    return this.get(input);
  }

  public async removeMember(input: {
    readonly organizationId: string;
    readonly teamId: string;
    readonly playerId: string;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<TeamResponse> {
    await this.require(input, "team:manage");
    this.assert(await this.repository.removeMember(input));
    return this.get(input);
  }

  private assert(result: TeamMutationResult): void {
    if (result === "ok") return;
    if (result === "captain-taken") {
      throw new ConflictException({
        code: "TEAM_CAPTAIN_TAKEN",
        message: "Diese Mannschaft führt bereits einen Captain.",
      });
    }
    if (result === "player-already-member") {
      throw new ConflictException({
        code: "TEAM_PLAYER_ALREADY_MEMBER",
        message: "Die Person gehört bereits zum Kader dieses Teams.",
      });
    }
    throw new NotFoundException({
      code: "NOT_FOUND",
      message: result === "player-not-found" ? "Player not found." : "Team not found.",
    });
  }

  private async require(
    input: { readonly organizationId: string; readonly auth: AuthContext },
    permission: "team:read" | "team:manage",
  ): Promise<void> {
    await this.access.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission,
    });
  }
}
