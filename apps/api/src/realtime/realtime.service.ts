import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import type { ApplicationEnvironment } from "@darts-platform/config";
import type { OutboxLogger } from "@darts-platform/database";
import { createClient, type RedisClientType } from "redis";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server, type Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";

import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { DatabaseService } from "../database/database.service.js";
import { parseSubscriptionId } from "./event-routing.js";
import { createHandshakeGate } from "./handshake-guard.js";
import { publishOutboxBatch, type RealtimeBroadcaster } from "./publish-outbox.js";
import { joinSubscription } from "./subscription-limit.js";

interface SubscribePayload {
  readonly tournamentId?: unknown;
  readonly encounterId?: unknown;
}

@Injectable()
export class RealtimeService implements OnApplicationShutdown, RealtimeBroadcaster {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly publisher: RedisClientType;
  private readonly subscriber: RedisClientType;
  private io: Server | null = null;
  private timer: NodeJS.Timeout | null = null;
  private publishing = false;

  /**
   * Bindet die Fehlerbuchung des Relays an den Anwendungslogger. In der
   * Produktion schreibt dieser JSON-Records; `outbox.dead_letter` ist damit
   * in den Railway-Logs auffindbar.
   */
  private readonly outboxLogger: OutboxLogger = {
    emit: (level, fields) => {
      if (level === "error") this.logger.error(fields);
      else if (level === "warn") this.logger.warn(fields);
      else if (level === "log") this.logger.log(fields);
      else this.logger.debug(fields);
    },
  };

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APPLICATION_ENVIRONMENT) private readonly environment: ApplicationEnvironment,
  ) {
    this.publisher = createClient({ url: environment.REDIS_URL });
    this.subscriber = this.publisher.duplicate();
  }

  public async attach(httpServer: HttpServer): Promise<void> {
    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
    this.io = new Server(httpServer, {
      cors: {
        origin: [
          this.environment.WEB_ORIGIN,
          ...this.environment.WEB_ADDITIONAL_ORIGINS,
        ],
        credentials: true,
      },
      transports: ["websocket", "polling"],
      // Der Handshake laeuft am Fastify-Rate-Limit vorbei (eigener Endpunkt am
      // HTTP-Server); ohne diese Bremse liesse sich der Verbindungsaufbau
      // beliebig oft wiederholen.
      allowRequest: createHandshakeGate({
        max: this.environment.RATE_LIMIT_SOCKET_MAX_PER_MINUTE,
        trustProxyHops: this.environment.TRUST_PROXY_HOPS,
        onRejected: (address) => {
          this.logger.warn({
            event: "realtime.handshake_rate_limited",
            address,
          });
        },
      }),
    });
    this.io.adapter(createAdapter(this.publisher, this.subscriber));
    this.io.on("connection", (socket) => this.register(socket));
    this.timer = setInterval(() => void this.publishOutbox(), 500);
    this.timer.unref();
  }

  public emit(room: string, event: string, payload: Readonly<Record<string, string>>): void {
    this.io?.to(room).emit(event, payload);
  }

  private register(socket: Socket): void {
    socket.on("tournament:subscribe", (payload: SubscribePayload) => {
      const tournamentId = parseSubscriptionId(payload?.tournamentId);
      if (tournamentId === null) return;
      this.subscribe(socket, `tournament:${tournamentId}`);
    });
    socket.on("encounter:subscribe", (payload: SubscribePayload) => {
      const encounterId = parseSubscriptionId(payload?.encounterId);
      if (encounterId === null) return;
      this.subscribe(socket, `encounter:${encounterId}`);
    });
  }

  private subscribe(socket: Socket, room: string): void {
    if (joinSubscription(socket, room) === "limit-reached") {
      this.logger.warn({
        event: "realtime.subscription_limit_reached",
        socketId: socket.id,
        room,
      });
    }
  }

  private async publishOutbox(): Promise<void> {
    if (this.publishing || this.io === null) return;
    this.publishing = true;
    try {
      await publishOutboxBatch(this.database.database, this, {
        logger: this.outboxLogger,
      });
    } catch (error) {
      this.logger.error("Outbox konnte nicht publiziert werden", error);
    } finally {
      this.publishing = false;
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    await this.io?.close();
    if (this.publisher.isOpen) await this.publisher.quit();
    if (this.subscriber.isOpen) await this.subscriber.quit();
  }
}
