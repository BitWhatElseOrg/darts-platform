/**
 * Die Poll-Schleife des Realtime-Outbox-Versands.
 *
 * Getrennt vom `RealtimeService`, damit ihr Lebenszyklus ohne Redis, Socket.IO
 * und Datenbank pruefbar ist. Zwei Zusagen tragen den geordneten Stopp:
 *
 * - `stop()` wartet auf einen laufenden Durchlauf. Vorher beendete
 *   `onApplicationShutdown` die Redis-Clients, waehrend ein Durchlauf noch auf
 *   die Datenbank wartete; sein Batch (bis zu 100 Ereignisse) lief danach gegen
 *   den geschlossenen Publisher -- 100 unbehandelte "The client is closed" im
 *   Quality Gate (Lauf 36106263385, 25.09.2026), und dieselbe Fehlerflut bei
 *   jedem Neustart auf Railway.
 * - Nach `stop()` beginnt kein weiterer Durchlauf, auch nicht aus einem Tick,
 *   der schon in der Ereignisschleife wartete.
 *
 * Durchlaeufe ueberlappen nicht: ein Tick waehrend eines laufenden Durchlaufs
 * wird uebersprungen, der naechste Tick holt nach.
 */
export class OutboxPublishLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = false;

  public constructor(
    private readonly publish: () => Promise<void>,
    private readonly intervalMs: number,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  public start(): void {
    if (this.timer !== null || this.stopped) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.inFlight !== null) await this.inFlight;
  }

  private tick(): void {
    if (this.stopped || this.inFlight !== null) return;
    this.inFlight = this.publish()
      .catch((error: unknown) => this.onError(error))
      .finally(() => {
        this.inFlight = null;
      });
  }
}
