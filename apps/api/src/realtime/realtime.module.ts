import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { RealtimeService } from "./realtime.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
