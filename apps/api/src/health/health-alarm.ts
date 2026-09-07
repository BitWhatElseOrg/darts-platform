import type { HealthResponse } from "@darts-platform/schemas";

/**
 * Wie oft ein anhaltender Alarm wiederholt wird. Ohne Wiederholung meldete
 * ein Ausfall genau einmal — wer erst danach hinschaut, sieht nichts mehr,
 * und eine Alarmregel, die auf ein Log-Muster horcht, feuert nie wieder.
 */
export const HEALTH_ALARM_REMINDER_MS = 900_000;

export type HealthAlarmEmission =
  | { readonly kind: "alarm"; readonly status: "degraded" | "unhealthy" }
  | { readonly kind: "recovered"; readonly downFor: number }
  | { readonly kind: "none" };

/**
 * Was ein Health-Durchlauf melden soll. Rein, damit die Entprellung prüfbar
 * bleibt: gemeldet wird bei jedem Statuswechsel und danach nur noch im
 * Erinnerungsabstand — sonst stünde je Sekunde eine Zeile im Log und die
 * eigentliche Meldung ginge darin unter.
 *
 * `previousStatus` ist `null` beim ersten Durchlauf nach dem Start. Ein
 * Dienst, der bereits beeinträchtigt hochkommt, meldet damit sofort.
 */
export function healthAlarmEmission(input: {
  readonly previousStatus: HealthResponse["status"] | null;
  readonly currentStatus: HealthResponse["status"];
  /** Wann zuletzt ein Alarm gemeldet wurde; null, wenn noch nie. */
  readonly lastAlarmAt: number | null;
  /** Seit wann der Dienst nicht mehr `ok` ist; null, wenn er es war. */
  readonly notOkSince: number | null;
  readonly now: number;
  readonly reminderMs?: number;
}): HealthAlarmEmission {
  const reminderMs = input.reminderMs ?? HEALTH_ALARM_REMINDER_MS;

  if (input.currentStatus === "ok") {
    // Erholung meldet nur, wer vorher wirklich beeinträchtigt war. Der erste
    // Durchlauf nach dem Start meldet nichts: „läuft" ist keine Nachricht.
    return input.previousStatus !== null && input.previousStatus !== "ok"
      ? { kind: "recovered", downFor: input.notOkSince === null ? 0 : input.now - input.notOkSince }
      : { kind: "none" };
  }

  const changed = input.previousStatus !== input.currentStatus;
  const due = input.lastAlarmAt === null || input.now - input.lastAlarmAt >= reminderMs;
  return changed || due ? { kind: "alarm", status: input.currentStatus } : { kind: "none" };
}
