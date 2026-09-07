import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HealthResponse, OutboxHealth } from "@darts-platform/schemas";

import { DatabaseService } from "../database/database.service.js";
import { RedisService } from "../redis/redis.service.js";
import { HealthAlarmService } from "./health-alarm.service.js";
import { HealthService } from "./health.service.js";
import { OutboxHealthService } from "./outbox-health.service.js";

/**
 * Der Wachtdienst haengt am echten `HealthService`; beeintraechtigt wird er
 * ueber den Outbox-Stand, genau wie in der Produktion — ein Rueckstand von
 * mehr als `OUTBOX_LAG_DEGRADED_SECONDS` bzw. ein Dead Letter.
 */
describe("HealthAlarmService", () => {
  const healthyOutbox: OutboxHealth = {
    publishLagSeconds: 0,
    statisticsLagSeconds: 0,
    deadLettered: 0,
  };
  const readOutbox = vi.fn(async (): Promise<OutboxHealth> => healthyOutbox);
  const checkDatabase = vi.fn(async (): Promise<void> => undefined);
  const checkRedis = vi.fn(async (): Promise<void> => undefined);
  let alarm: HealthAlarmService;
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    readOutbox.mockResolvedValue(healthyOutbox);
    checkDatabase.mockResolvedValue(undefined);
    checkRedis.mockResolvedValue(undefined);
    warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);

    const moduleReference = await Test.createTestingModule({
      providers: [
        HealthAlarmService,
        HealthService,
        { provide: DatabaseService, useValue: { checkConnection: checkDatabase } },
        { provide: RedisService, useValue: { checkConnection: checkRedis } },
        { provide: OutboxHealthService, useValue: { read: readOutbox } },
      ],
    }).compile();
    alarm = moduleReference.get(HealthAlarmService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("schweigt, solange alles laeuft", async () => {
    await alarm.check();
    await alarm.check();

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("meldet einen Outbox-Rueckstand als health.alarm auf Warnstufe", async () => {
    readOutbox.mockResolvedValue({ ...healthyOutbox, statisticsLagSeconds: 120 });

    await alarm.check();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      event: "health.alarm",
      status: "degraded",
      outbox: { statisticsLagSeconds: 120 },
    });
  });

  it("wiederholt denselben Alarm nicht bei jedem Durchlauf", async () => {
    readOutbox.mockResolvedValue({ ...healthyOutbox, deadLettered: 3 });

    await alarm.check();
    await alarm.check();
    await alarm.check();

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("meldet eine fehlende Abhaengigkeit auf Fehlerstufe", async () => {
    checkRedis.mockRejectedValue(new Error("connection refused"));

    await alarm.check();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toMatchObject({
      event: "health.alarm",
      status: "unhealthy",
      services: { database: "ok", redis: "error" },
    });
  });

  it("meldet die Erholung mit der Dauer", async () => {
    readOutbox.mockResolvedValue({ ...healthyOutbox, deadLettered: 1 });
    await alarm.check();
    readOutbox.mockResolvedValue(healthyOutbox);

    await alarm.check();

    const recovered = log.mock.calls.find(
      (call: readonly unknown[]) =>
        (call[0] as { event?: string } | undefined)?.event === "health.recovered",
    );
    expect(recovered?.[0]).toMatchObject({ event: "health.recovered" });
    expect((recovered?.[0] as { downForSeconds: number }).downForSeconds).toBeGreaterThanOrEqual(0);
  });

  /**
   * PR-Agent-Befund «Missed Alert»: ein gescheiterter Durchlauf meldete unter
   * eigenem Namen und ohne Entprellung — die Alarmregel horcht aber auf
   * `health.alarm`, und ohne Entprellung stuende jede Minute eine neue Zeile
   * im Log. Er laeuft jetzt durch dieselbe Meldung wie ein echtes Unhealthy.
   */
  it("meldet einen gescheiterten Durchlauf als health.alarm und wiederholt ihn nicht", async () => {
    const failing = {
      getHealth: vi.fn(async (): Promise<HealthResponse> => {
        throw new Error("Sondierung nicht moeglich");
      }),
    };
    const moduleReference = await Test.createTestingModule({
      providers: [HealthAlarmService, { provide: HealthService, useValue: failing }],
    }).compile();
    const service = moduleReference.get(HealthAlarmService);

    await service.check();
    await service.check();
    await service.check();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toMatchObject({
      event: "health.alarm",
      status: "unhealthy",
      checkFailed: true,
      message: "Sondierung nicht moeglich",
    });
  });

  it("meldet die Erholung, nachdem die Messung wieder gelingt", async () => {
    const health = { getHealth: vi.fn() };
    health.getHealth.mockRejectedValueOnce(new Error("Sondierung nicht moeglich"));
    health.getHealth.mockResolvedValue({
      status: "ok",
      services: { database: "ok", redis: "ok" },
      outbox: healthyOutbox,
    });
    const moduleReference = await Test.createTestingModule({
      providers: [HealthAlarmService, { provide: HealthService, useValue: health }],
    }).compile();
    const service = moduleReference.get(HealthAlarmService);

    await service.check();
    await service.check();

    expect(error).toHaveBeenCalledTimes(1);
    const recovered = log.mock.calls.find(
      (call: readonly unknown[]) =>
        (call[0] as { event?: string } | undefined)?.event === "health.recovered",
    );
    expect(recovered?.[0]).toMatchObject({ event: "health.recovered" });
  });
});
