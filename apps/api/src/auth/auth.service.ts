import { Inject, Injectable } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";

import type { ApplicationEnvironment } from "@darts-platform/config";

import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { DatabaseService } from "../database/database.service.js";
import { createAuth, type DartsAuth } from "./auth.factory.js";
import type { AuthContext } from "./auth.types.js";

@Injectable()
export class AuthService {
  public readonly auth: DartsAuth;

  public constructor(
    @Inject(DatabaseService) databaseService: DatabaseService,
    @Inject(APPLICATION_ENVIRONMENT)
    environment: ApplicationEnvironment,
  ) {
    this.auth = createAuth(databaseService.database, environment);
  }

  public async getSession(
    headers: IncomingHttpHeaders,
  ): Promise<AuthContext | null> {
    const result = await this.auth.api.getSession({
      headers: fromNodeHeaders(headers),
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
