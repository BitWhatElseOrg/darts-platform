import { Body, Controller, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";

import {
  previewInvitationInputSchema,
  type InvitationPreview,
  type PreviewInvitationInput,
} from "@darts-platform/schemas";

import { Public } from "../auth/public.decorator.js";
import { parseBody } from "../common/parse-body.js";
import { OrganizationsService } from "./organizations.service.js";

/**
 * Oeffentlicher Endpunkt der Einladungsseite: die eingeladene Person hat
 * noch kein Konto. Er gibt nur nach erfolgreichem Hash-Vergleich etwas
 * zurueck und liegt unter dem sensiblen Rate-Limit (`rate-limit.ts`).
 */
@Controller("invitations")
@Public()
export class InvitationPreviewController {
  public constructor(
    @Inject(OrganizationsService)
    private readonly organizationsService: OrganizationsService,
  ) {}

  @Post(":invitationId/preview")
  public async preview(
    @Param("invitationId", ParseUUIDPipe) invitationId: string,
    @Body() body: unknown,
  ): Promise<InvitationPreview> {
    const data: PreviewInvitationInput = parseBody(previewInvitationInputSchema, body);
    return this.organizationsService.previewInvitation({ invitationId, data });
  }
}
