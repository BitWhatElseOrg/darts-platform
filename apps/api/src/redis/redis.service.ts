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

  /**
   * Zaehlt eine Anfrage gegen `key` im rollenden Fenster und sagt, ob sie
   * durchgeht. `INCR` ist atomar; die Lebensdauer wird nur beim ersten
   * Treffer gesetzt, damit das Fenster nicht bei jeder Anfrage neu beginnt
   * und ein Dauerbeschuss die Sperre nicht endlos verlaengert.
   */
  public async consumeRateLimit(
    key: string,
    windowSeconds: number,
    max: number,
  ): Promise<{ readonly allowed: boolean; readonly retryAfter: number | null }> {
    await this.ensureConnected();

    const namespacedKey = `rate-limit:${key}`;
    const count = await this.client.incr(namespacedKey);

    if (count === 1) {
      await this.client.expire(namespacedKey, windowSeconds);
    }

    if (count <= max) {
      return { allowed: true, retryAfter: null };
    }

    const remainingSeconds = await this.client.ttl(namespacedKey);
    return {
      allowed: false,
      retryAfter: remainingSeconds > 0 ? remainingSeconds : windowSeconds,
    };
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
