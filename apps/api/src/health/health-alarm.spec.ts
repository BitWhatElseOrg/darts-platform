import { describe, expect, it } from "vitest";

import { HEALTH_ALARM_REMINDER_MS, healthAlarmEmission } from "./health-alarm.js";

const now = 1_000_000;

describe("healthAlarmEmission", () => {
  it("meldet nichts, solange alles laeuft", () => {
    expect(
      healthAlarmEmission({ previousStatus: "ok", currentStatus: "ok", lastAlarmAt: null, notOkSince: null, now }),
    ).toEqual({ kind: "none" });
  });

  it("schweigt auch beim ersten Durchlauf eines gesunden Starts", () => {
    expect(
      healthAlarmEmission({ previousStatus: null, currentStatus: "ok", lastAlarmAt: null, notOkSince: null, now }),
    ).toEqual({ kind: "none" });
  });

  it("meldet sofort, wenn der Dienst bereits beeintraechtigt hochkommt", () => {
    expect(
      healthAlarmEmission({ previousStatus: null, currentStatus: "degraded", lastAlarmAt: null, notOkSince: now, now }),
    ).toEqual({ kind: "alarm", status: "degraded" });
  });

  it("meldet den Wechsel von ok nach degraded", () => {
    expect(
      healthAlarmEmission({ previousStatus: "ok", currentStatus: "degraded", lastAlarmAt: null, notOkSince: now, now }),
    ).toEqual({ kind: "alarm", status: "degraded" });
  });

  it("meldet die Verschaerfung von degraded nach unhealthy sofort", () => {
    expect(
      healthAlarmEmission({
        previousStatus: "degraded",
        currentStatus: "unhealthy",
        lastAlarmAt: now - 1_000,
        notOkSince: now - 60_000,
        now,
      }),
    ).toEqual({ kind: "alarm", status: "unhealthy" });
  });

  it("schweigt zwischen zwei Erinnerungen bei unveraendertem Status", () => {
    expect(
      healthAlarmEmission({
        previousStatus: "degraded",
        currentStatus: "degraded",
        lastAlarmAt: now - 1_000,
        notOkSince: now - 60_000,
        now,
      }),
    ).toEqual({ kind: "none" });
  });

  it("wiederholt den Alarm nach dem Erinnerungsabstand", () => {
    expect(
      healthAlarmEmission({
        previousStatus: "degraded",
        currentStatus: "degraded",
        lastAlarmAt: now - HEALTH_ALARM_REMINDER_MS,
        notOkSince: now - HEALTH_ALARM_REMINDER_MS,
        now,
      }),
    ).toEqual({ kind: "alarm", status: "degraded" });
  });

  it("meldet die Erholung mit der Dauer der Stoerung", () => {
    expect(
      healthAlarmEmission({
        previousStatus: "unhealthy",
        currentStatus: "ok",
        lastAlarmAt: now - 5_000,
        notOkSince: now - 120_000,
        now,
      }),
    ).toEqual({ kind: "recovered", downFor: 120_000 });
  });
});
