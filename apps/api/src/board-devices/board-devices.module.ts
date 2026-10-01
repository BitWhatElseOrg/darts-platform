import { Module } from "@nestjs/common";

import { OrganizationsModule } from "../organizations/organizations.module.js";
import { BoardDeviceSelfController } from "./board-device-self.controller.js";
import { BoardDevicesController } from "./board-devices.controller.js";
import { BoardDevicesRepository } from "./board-devices.repository.js";
import { BoardDevicesService } from "./board-devices.service.js";

@Module({
  imports: [OrganizationsModule],
  controllers: [BoardDeviceSelfController, BoardDevicesController],
  providers: [BoardDevicesRepository, BoardDevicesService],
  exports: [BoardDevicesRepository, BoardDevicesService],
})
export class BoardDevicesModule {}
