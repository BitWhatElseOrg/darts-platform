import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";

import type { ApplicationEnvironment } from "@darts-platform/config";

import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";

@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly client: RedisClientType;
  private readonly logger = new Logger(RedisService.name);
  private connecting: Promise<void> | undefined;

  public constructor(
    @Inject(APPLICATION_ENVIRONMENT)
    environment: ApplicationEnvironment,
  ) {
    this.client = createClient({
      url: environment.REDIS_URL,
      socket: {
        connectTimeout: 5_000,
        reconnectStrategy: false,
      },
    });

    this.client.on("error", (error: Error) => {
      this.logger.error("Redis client error", error.stack);
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isReady) {
      return;
    }

    if (this.connecting === undefined) {
      this.connecting = this.client
        .connect()
        .then(() => undefined)
        .finally(() => {
          this.connecting = undefined;
        });
    }

    await this.connecting;
  }

  public async checkConnection(): Promise<void> {
    await this.ensureConnected();

    const response = await this.client.ping();
    if (response !== "PONG") {
      throw new Error(`Unexpected Redis PING response: ${response}`);
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.connecting !== undefined) {
      await this.connecting.catch(() => undefined);
    }

    if (this.client.isOpen) {
      await this.client.quit();
    }
  }
}
