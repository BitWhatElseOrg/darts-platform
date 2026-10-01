import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";

import { ALLOW_DEVICE_ENDPOINT } from "./allow-device.decorator.js";
import { AuthService } from "./auth.service.js";
import { BoardDeviceAuthenticator } from "./board-device-authenticator.js";
import { readDeviceBearer } from "./device-bearer.js";
import { IS_PUBLIC_ENDPOINT } from "./public.decorator.js";

@Injectable()
export class AuthGuard implements CanActivate {
  public constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(BoardDeviceAuthenticator) private readonly devices: BoardDeviceAuthenticator,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_ENDPOINT,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const deviceSecret = readDeviceBearer(request.headers);

    // Ein Bearer-Schluessel ist eindeutig ein Geraet: die Session wird dann
    // nicht mehr gelesen. Ein ungueltiger Schluessel neben einem gueltigen
    // Cookie ergibt 401, nicht einen stillen Rueckfall auf den Benutzer.
    if (deviceSecret !== null) {
      const device = await this.devices.authenticate(deviceSecret);
      if (device === null) {
        throw new UnauthorizedException({ code: "DEVICE_REVOKED", message: "This device is not paired anymore." });
      }
      const allowsDevice = this.reflector.getAllAndOverride<boolean>(
        ALLOW_DEVICE_ENDPOINT,
        [context.getHandler(), context.getClass()],
      );
      if (allowsDevice !== true) {
        throw new ForbiddenException({ code: "DEVICE_NOT_ALLOWED", message: "Devices may not use this endpoint." });
      }
      request.deviceContext = { device };
      return true;
    }

    const authContext = await this.authService.getSession(request.headers);

    if (authContext === null) {
      throw new UnauthorizedException("Authentication is required.");
    }

    request.authContext = authContext;
    return true;
  }
}
