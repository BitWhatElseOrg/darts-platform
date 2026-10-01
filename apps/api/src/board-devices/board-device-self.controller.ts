import { Controller, ForbiddenException, Get, Inject, UnauthorizedException } from "@nestjs/common";

import { boardDeviceSelfSchema, type BoardDeviceSelf } from "@darts-platform/schemas";

import { AllowDevice } from "../auth/allow-device.decorator.js";
import { CurrentPrincipal } from "../auth/current-principal.decorator.js";
import { isDevicePrincipal, type Principal } from "../auth/auth.types.js";
import { BoardDevicesRepository } from "./board-devices.repository.js";

@Controller("board-devices")
export class BoardDeviceSelfController {
  public constructor(@Inject(BoardDevicesRepository) private readonly repository: BoardDevicesRepository) {}

  @Get("me")
  @AllowDevice()
  public async me(@CurrentPrincipal() principal: Principal): Promise<BoardDeviceSelf> {
    if (!isDevicePrincipal(principal)) {
      throw new ForbiddenException({ code: "DEVICE_REQUIRED", message: "Only a paired device can read this." });
    }
    const self = await this.repository.getSelf(principal.device);
    if (self === null) {
      throw new UnauthorizedException({ code: "DEVICE_REVOKED", message: "This device is not paired anymore." });
    }
    return boardDeviceSelfSchema.parse(self);
  }
}
