import { Module } from "@nestjs/common";

import { BoardDeviceSelfController } from "./board-device-self.controller.js";
import { BoardDevicesRepository } from "./board-devices.repository.js";

@Module({
  controllers: [BoardDeviceSelfController],
  providers: [BoardDevicesRepository],
  exports: [BoardDevicesRepository],
})
export class BoardDevicesModule {}
