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
import { OutboxPublishLoop } from "./outbox-publish-loop.js";
import { publishOutboxBatch, type RealtimeBroadcaster } from "./publish-outbox.js";
import { SubscriptionAuthorization } from "./subscription-authorization.js";
import { joinSubscription, rejectSubscription } from "./subscription-limit.js";

interface SubscribePayload {
  readonly publicId?: unknown;
  readonly displayKey?: unknown;
}

@Injectable()
export class RealtimeService implements OnApplicationShutdown, RealtimeBroadcaster {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly publisher: RedisClientType;
  private readonly subscriber: RedisClientType;
  private io: Server | null = null;
  /**
   * Poll-Schleife des Outbox-Versands. `stop()` wartet auf den laufenden
   * Durchlauf, bevor Socket.IO und Redis schliessen -- sonst laeuft ein
   * Batch gegen den beendeten Publisher (siehe outbox-publish-loop.ts).
   */
  private readonly loop = new OutboxPublishLoop(
    () => this.publishOutbox(),
    500,
    (error) => this.logger.error("Outbox konnte nicht publiziert werden", error),
  );

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
    @Inject(SubscriptionAuthorization) private readonly authorization: SubscriptionAuthorization,
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
    this.loop.start();
  }

  public emit(room: string, event: string, payload: Readonly<Record<string, string>>): void {
    this.io?.to(room).emit(event, payload);
  }

  private register(socket: Socket): void {
    socket.on("tournament:subscribe", (payload: SubscribePayload) => {
      void this.subscribeTournament(socket, payload);
    });
    socket.on("encounter:subscribe", (payload: SubscribePayload) => {
      void this.subscribeEncounter(socket, payload);
    });
  }

  private async subscribeTournament(socket: Socket, payload: SubscribePayload): Promise<void> {
    const publicId = parseSubscriptionId(payload?.publicId);
    if (publicId === null) {
      rejectSubscription(socket, "tournament:?", "SUBSCRIPTION_UNKNOWN_ROOM");
      return;
    }
    const decision = await this.authorization.authorizeTournament({
      publicId,
      headers: socket.handshake.headers,
      displayKeySecret:
        typeof payload?.displayKey === "string" ? payload.displayKey : undefined,
    });
    const room = `tournament:${publicId}`;
    if (decision.kind === "deny") {
      // Auf Warnstufe, mit dem Grund: in den Logs unterscheidbar, nach aussen
      // nicht — der Client bekommt beide Gruende gleich serviert.
      this.logger.warn({
        event: "realtime.subscription_denied",
        room,
        reason: decision.reason,
      });
      rejectSubscription(socket, room, decision.reason);
      return;
    }
    this.subscribe(socket, room);
  }

  private async subscribeEncounter(socket: Socket, payload: SubscribePayload): Promise<void> {
    const publicId = parseSubscriptionId(payload?.publicId);
    if (publicId === null) {
      rejectSubscription(socket, "encounter:?", "SUBSCRIPTION_UNKNOWN_ROOM");
      return;
    }
    const decision = await this.authorization.authorizeEncounter({ publicId });
    const room = `encounter:${publicId}`;
    if (decision.kind === "deny") {
      this.logger.warn({
        event: "realtime.subscription_denied",
        room,
        reason: decision.reason,
      });
      rejectSubscription(socket, room, decision.reason);
      return;
    }
    this.subscribe(socket, room);
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
    if (this.io === null) return;
    await publishOutboxBatch(this.database.database, this, {
      logger: this.outboxLogger,
    });
  }

  public async onApplicationShutdown(): Promise<void> {
    // Reihenfolge: erst kein neuer Durchlauf und den laufenden abwarten, dann
    // Socket.IO schliessen, zuletzt Redis. `io` auf null: ein `emit` aus einer
    // noch offenen HTTP-Anfrage trifft danach keinen geschlossenen Adapter.
    await this.loop.stop();
    const io = this.io;
    this.io = null;
    await io?.close();
    if (this.publisher.isOpen) await this.publisher.quit();
    if (this.subscriber.isOpen) await this.subscriber.quit();
  }
}
