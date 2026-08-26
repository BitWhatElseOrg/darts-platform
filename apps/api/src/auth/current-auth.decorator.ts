import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import type { AuthContext } from "./auth.types.js";

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    if (request.authContext === undefined) {
      throw new UnauthorizedException("Authentication is required.");
    }

    return request.authContext;
  },
);
