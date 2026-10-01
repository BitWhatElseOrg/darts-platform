import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { BoardDeviceAuthenticator } from "./board-device-authenticator.js";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    BoardDeviceAuthenticator,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  exports: [AuthService, BoardDeviceAuthenticator],
})
export class AuthModule {}
