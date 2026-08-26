import { ForbiddenException, Inject, Injectable } from "@nestjs/common";

import {
  hasOrganizationPermission,
  isOrganizationRole,
  type OrganizationPermission,
  type OrganizationRole,
} from "@darts-platform/domain";

import { OrganizationsRepository } from "./organizations.repository.js";

@Injectable()
export class OrganizationAccessService {
  public constructor(
    @Inject(OrganizationsRepository)
    private readonly organizationsRepository: OrganizationsRepository,
  ) {}

  public async requirePermission(input: {
    readonly organizationId: string;
    readonly userId: string;
    readonly permission: OrganizationPermission;
  }): Promise<OrganizationRole> {
    const membership =
      await this.organizationsRepository.getActiveMembership(input);

    if (
      membership === null ||
      !isOrganizationRole(membership.role) ||
      !hasOrganizationPermission(membership.role, input.permission)
    ) {
      throw new ForbiddenException(
        "You do not have permission to access this organization resource.",
      );
    }

    return membership.role;
  }
}
