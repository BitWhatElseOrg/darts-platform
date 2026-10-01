import { createParamDecorator, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import type { Principal } from "./auth.types.js";

export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): Principal => {
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  const principal = request.deviceContext ?? request.authContext;
  if (principal === undefined) throw new UnauthorizedException("Authentication is required.");
  return principal;
});
