import { Controller, Get, Inject, Param, ParseUUIDPipe } from "@nestjs/common";
import type { PublicEncounter } from "@darts-platform/schemas";

import { Public } from "../auth/public.decorator.js";
import { EncountersService } from "./encounters.service.js";

@Public()
@Controller("public/encounters")
export class PublicEncountersController {
  public constructor(@Inject(EncountersService) private readonly service: EncountersService) {}

  @Get(":publicId")
  public live(@Param("publicId", ParseUUIDPipe) publicId: string): Promise<PublicEncounter> {
    return this.service.publicView(publicId);
  }
}
