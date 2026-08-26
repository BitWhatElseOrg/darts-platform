import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";

import type { ApplicationEnvironment } from "@darts-platform/config";
import {
  createDatabaseConnection,
  type Database,
  type DatabaseConnection,
} from "@darts-platform/database";

import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly connection: DatabaseConnection;

  public constructor(
    @Inject(APPLICATION_ENVIRONMENT)
    environment: ApplicationEnvironment,
  ) {
    this.connection = createDatabaseConnection(environment.DATABASE_URL);
  }

  public get database(): Database {
    return this.connection.database;
  }

  public async checkConnection(): Promise<void> {
    await this.connection.check();
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}
