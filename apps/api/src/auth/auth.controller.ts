import { All, Controller, Inject, Req, Res } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyReply, FastifyRequest } from "fastify";

import type { ApplicationEnvironment } from "@darts-platform/config";

import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { AuthService } from "./auth.service.js";
import { CLIENT_IP_HEADER } from "./client-ip.js";
import { Public } from "./public.decorator.js";

@Controller("auth")
@Public()
export class AuthController {
  public constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(APPLICATION_ENVIRONMENT)
    private readonly environment: ApplicationEnvironment,
  ) {}

  @All()
  public async handleRoot(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.respond(request, reply);
  }

  @All("*")
  public async handlePath(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.respond(request, reply);
  }

  private async respond(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const url = new URL(request.url, this.environment.BETTER_AUTH_URL);
    const headers = fromNodeHeaders(request.headers);
    headers.delete("content-length");
    // `set` statt `append`: ein vom Client mitgeschickter Wert wird
    // ueberschrieben, nicht ergaenzt (siehe `client-ip.ts`).
    headers.set(CLIENT_IP_HEADER, request.ip);

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const authRequest = new Request(url, {
      method: request.method,
      headers,
      ...(hasBody && request.body !== undefined
        ? { body: JSON.stringify(request.body) }
        : {}),
    });

    const response = await this.authService.auth.handler(authRequest);
    reply.status(response.status);

    response.headers.forEach((value, key) => {
      if (key !== "set-cookie") {
        reply.header(key, value);
      }
    });

    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) {
      reply.header("set-cookie", cookies);
    }

    const body = response.body === null ? null : await response.text();
    await reply.send(body);
  }
}
