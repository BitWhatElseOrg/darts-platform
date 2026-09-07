import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";

import { HealthService } from "./health.service.js";
import { healthAlarmEmission } from "./health-alarm.js";

/**
 * Abstand zwischen zwei Health-Durchlaeufen. Eine Minute reicht: der
 * Outbox-Rueckstand gilt ab 60 Sekunden als Beeintraechtigung
 * (`OUTBOX_LAG_DEGRADED_SECONDS`), schneller zu messen brächte keine
 * fruehere Erkenntnis.
 */
export const HEALTH_ALARM_INTERVAL_MS = 60_000;

/**
 * Beobachtet den eigenen Health-Zustand und meldet ihn ins Log, statt darauf
 * zu warten, dass jemand `/api/v1/health` abfragt. Der Endpunkt lieferte
 * `degraded` schon vorher — nur sah es niemand, solange kein Mensch hinschaute
 * (offener Punkt aus dem Audit: „Alarmierung auf `degraded` fehlt").
 *
 * Alarmiert wird ueber genau EIN Ereignis, `health.alarm`, mit dem Status im
 * Feld: so genuegt in Railway eine einzige Regel auf dieses Muster fuer beide
 * Stufen. Die Erholung meldet `health.recovered`.
 *
 * Bewusst in der API und nicht im Worker: der Zustand entsteht hier, ein
 * zweiter Dienst muesste ihn ueber HTTP erfragen und braeuchte dafuer eine
 * weitere Adresse in der Umgebung. Ausserdem greift der CI-Rauchtest die
 * Worker-Logs auf Fehlerstufen ab (`.github/workflows/ci.yml`) — ein
 * Alarm von dort liesse den Rauchtest scheitern.
 */
@Injectable()
export class HealthAlarmService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HealthAlarmService.name);
  private timer: NodeJS.Timeout | null = null;
  private checking = false;
  private previousStatus: "ok" | "degraded" | "unhealthy" | null = null;
  private lastAlarmAt: number | null = null;
  private notOkSince: number | null = null;

  public constructor(
    @Inject(HealthService) private readonly healthService: HealthService,
  ) {}

  public onApplicationBootstrap(): void {
    // `unref`, damit der Zeitgeber einen sonst beendeten Prozess nicht
    // offenhaelt — etwa im Test, der die Anwendung baut und wieder schliesst.
    this.timer = setInterval(() => void this.check(), HEALTH_ALARM_INTERVAL_MS);
    this.timer.unref();
    void this.check();
  }

  public onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Ein Durchlauf. Oeffentlich, damit der Integrationstest ihn ohne Zeitgeber
   * ausloesen kann; ein zweiter Aufruf waehrend eines laufenden kehrt sofort
   * zurueck.
   */
  public async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const health = await this.healthService.getHealth();
      const now = Date.now();
      const emission = healthAlarmEmission({
        previousStatus: this.previousStatus,
        currentStatus: health.status,
        lastAlarmAt: this.lastAlarmAt,
        notOkSince: this.notOkSince,
        now,
      });

      if (emission.kind === "alarm") {
        this.lastAlarmAt = now;
        const fields = {
          event: "health.alarm",
          status: emission.status,
          services: health.services,
          outbox: health.outbox,
        };
        if (emission.status === "unhealthy") this.logger.error(fields);
        else this.logger.warn(fields);
      } else if (emission.kind === "recovered") {
        this.logger.log({
          event: "health.recovered",
          downForSeconds: Math.round(emission.downFor / 1_000),
        });
      }

      this.notOkSince =
        health.status === "ok" ? null : (this.notOkSince ?? now);
      if (health.status === "ok") this.lastAlarmAt = null;
      this.previousStatus = health.status;
    } catch (error) {
      // Scheitert der Durchlauf selbst, ist das derselbe Betriebsvorfall wie
      // ein unhealthy — nur ohne Messwert. Er darf nicht lautlos bleiben.
      this.logger.error({
        event: "health.alarm_check_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.checking = false;
    }
  }
}
