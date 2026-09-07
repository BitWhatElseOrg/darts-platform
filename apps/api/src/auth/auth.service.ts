import { Inject, Injectable } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";

import type { ApplicationEnvironment } from "@darts-platform/config";

import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { DatabaseService } from "../database/database.service.js";
import { RedisService } from "../redis/redis.service.js";
import { createRedisRateLimitStorage } from "./auth-rate-limit-storage.js";
import { createAuth, type DartsAuth } from "./auth.factory.js";
import { CLIENT_IP_HEADER } from "./client-ip.js";
import type { AuthContext } from "./auth.types.js";

@Injectable()
export class AuthService {
  public readonly auth: DartsAuth;

  public constructor(
    @Inject(DatabaseService) databaseService: DatabaseService,
    @Inject(APPLICATION_ENVIRONMENT)
    environment: ApplicationEnvironment,
    @Inject(RedisService) redisService: RedisService,
  ) {
    this.auth = createAuth(
      databaseService.database,
      environment,
      createRedisRateLimitStorage(redisService),
    );
  }

  public async getSession(
    headers: IncomingHttpHeaders,
  ): Promise<AuthContext | null> {
    const authHeaders = fromNodeHeaders(headers);
    // Diese Header kommen unveraendert vom Client. Den Adress-Header setzt
    // allein `AuthController` aus `request.ip`; auf dem Lesepfad gibt es
    // keine Anfrage, aus der er sich ableiten liesse, also wird ein
    // mitgeschickter Wert verworfen statt geglaubt (siehe `client-ip.ts`).
    authHeaders.delete(CLIENT_IP_HEADER);
    const result = await this.auth.api.getSession({
      headers: authHeaders,
    });

    if (result === null) {
      return null;
    }

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
      },
      session: {
        id: result.session.id,
        expiresAt: result.session.expiresAt,
      },
    };
  }
}
