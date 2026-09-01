import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import type { ApplicationEnvironment } from "@darts-platform/config";
import { outboxEvents, tournamentMatches } from "@darts-platform/database";
import { and, asc, eq, isNull } from "drizzle-orm";
import { createClient, type RedisClientType } from "redis";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server, type Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";

import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";
import { DatabaseService } from "../database/database.service.js";

interface SubscribePayload {
  readonly tournamentId?: unknown;
}

@Injectable()
export class RealtimeService implements OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly publisher: RedisClientType;
  private readonly subscriber: RedisClientType;
  private io: Server | null = null;
  private timer: NodeJS.Timeout | null = null;
  private publishing = false;

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
    });
    this.io.adapter(createAdapter(this.publisher, this.subscriber));
    this.io.on("connection", (socket) => this.register(socket));
    this.timer = setInterval(() => void this.publishOutbox(), 500);
    this.timer.unref();
  }

  private register(socket: Socket): void {
    socket.on("tournament:subscribe", (payload: SubscribePayload) => {
      if (typeof payload.tournamentId !== "string" || !/^[0-9a-f-]{36}$/iu.test(payload.tournamentId)) {
        return;
      }
      void socket.join(`tournament:${payload.tournamentId}`);
    });
  }

  private async publishOutbox(): Promise<void> {
    if (this.publishing || this.io === null) return;
    this.publishing = true;
    try {
      const events = await this.database.database
        .select()
        .from(outboxEvents)
        .where(isNull(outboxEvents.publishedAt))
        .orderBy(asc(outboxEvents.occurredAt))
        .limit(100);
      for (const event of events) {
        const tournamentId = await this.resolveTournamentId(event.aggregateType, event.aggregateId);
        if (tournamentId !== null) {
          this.io.to(`tournament:${tournamentId}`).emit("tournament:changed", {
            eventId: event.id,
            eventType: event.eventType,
            tournamentId,
            occurredAt: event.occurredAt.toISOString(),
          });
        }
        await this.database.database
          .update(outboxEvents)
          .set({ publishedAt: new Date() })
          .where(and(eq(outboxEvents.id, event.id), isNull(outboxEvents.publishedAt)));
      }
    } catch (error) {
      this.logger.error("Outbox konnte nicht publiziert werden", error);
    } finally {
      this.publishing = false;
    }
  }

  private async resolveTournamentId(aggregateType: string, aggregateId: string): Promise<string | null> {
    if (aggregateType === "Tournament") return aggregateId;
    if (aggregateType !== "Match") return null;
    const [match] = await this.database.database
      .select({ tournamentId: tournamentMatches.tournamentId })
      .from(tournamentMatches)
      .where(eq(tournamentMatches.scoringMatchId, aggregateId))
      .limit(1);
    return match?.tournamentId ?? null;
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    await this.io?.close();
    if (this.publisher.isOpen) await this.publisher.quit();
    if (this.subscriber.isOpen) await this.subscriber.quit();
  }
}
