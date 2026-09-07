import { Inject, Injectable, Logger } from "@nestjs/common";

import type {
  HealthResponse,
  OutboxHealth,
  ServiceHealthStatus,
} from "@darts-platform/schemas";

import { DatabaseService } from "../database/database.service.js";
import { RedisService } from "../redis/redis.service.js";
import { OutboxHealthService } from "./outbox-health.service.js";

/** Ab dieser Rückstandsdauer je Konsument gilt der Dienst als beeinträchtigt. */
export const OUTBOX_LAG_DEGRADED_SECONDS = 60;

const unknownOutbox: OutboxHealth = {
  publishLagSeconds: null,
  statisticsLagSeconds: null,
  deadLettered: 0,
};

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  public constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(RedisService) private readonly redisService: RedisService,
    @Inject(OutboxHealthService)
    private readonly outboxHealthService: OutboxHealthService,
  ) {}

  private async check(checker: () => Promise<void>): Promise<ServiceHealthStatus> {
    try {
      await checker();
      return "ok";
    } catch {
      return "error";
    }
  }

  /**
   * Ist die Datenbank weg, scheitert auch diese Abfrage — das meldet bereits
   * `services.database`. Der Rückstand wird dann als unbekannt ausgewiesen,
   * statt die ganze Antwort scheitern zu lassen.
   */
  private async readOutbox(): Promise<OutboxHealth> {
    try {
      return await this.outboxHealthService.read();
    } catch (error) {
      // Ohne diese Zeile verschwände ein scheiterndes Sondieren lautlos
      // hinter `null`-Werten. Nur die Fehlermeldung, keine Nutzdaten.
      this.logger.warn(
        `outbox.health_unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return unknownOutbox;
    }
  }

  public async getHealth(): Promise<HealthResponse> {
    const [database, redis, outbox] = await Promise.all([
      this.check(() => this.databaseService.checkConnection()),
      this.check(() => this.redisService.checkConnection()),
      this.readOutbox(),
    ]);

    const dependenciesAvailable = database === "ok" && redis === "ok";
    const outboxDegraded =
      outbox.deadLettered > 0 ||
      exceedsThreshold(outbox.publishLagSeconds) ||
      exceedsThreshold(outbox.statisticsLagSeconds);

    return {
      status: resolveStatus(dependenciesAvailable, outboxDegraded),
      services: {
        database,
        redis,
      },
      outbox,
    };
  }
}

function exceedsThreshold(lagSeconds: number | null): boolean {
  return lagSeconds !== null && lagSeconds >= OUTBOX_LAG_DEGRADED_SECONDS;
}

/**
 * Die drei Stufen ausgeschrieben statt als verschachtelte Bedingung: eine
 * fehlende Abhängigkeit schlägt alles andere, denn ohne Datenbank ist der
 * gemeldete Rückstand ohnehin unbekannt.
 */
function resolveStatus(
  dependenciesAvailable: boolean,
  outboxDegraded: boolean,
): HealthResponse["status"] {
  if (!dependenciesAvailable) return "unhealthy";
  if (outboxDegraded) return "degraded";
  return "ok";
}
