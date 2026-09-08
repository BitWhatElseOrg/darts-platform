import { Module } from "@nestjs/common";

import { InvitationsController } from "./invitations.controller.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationsController } from "./organizations.controller.js";
import { OrganizationsRepository } from "./organizations.repository.js";
import { OrganizationsService } from "./organizations.service.js";

@Module({
  controllers: [OrganizationsController, InvitationsController],
  providers: [
    OrganizationsRepository,
    OrganizationAccessService,
    OrganizationsService,
  ],
  exports: [OrganizationAccessService, OrganizationsRepository],
})
export class OrganizationsModule {}
