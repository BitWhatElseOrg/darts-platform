import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OutboxPublishLoop } from "./outbox-publish-loop.js";

/**
 * CI-Flake vom 25.09.2026 (Lauf 36106263385): `realtime.service.integration
 * .spec.ts` meldete 100 unbehandelte Fehler "The client is closed". Beim
 * Herunterfahren beendete `onApplicationShutdown` die Redis-Clients, waehrend
 * ein Outbox-Durchlauf noch auf die Datenbank wartete; sein Batch von 100
 * Ereignissen lief danach gegen den geschlossenen Publisher. `stop()` muss
 * deshalb auf den laufenden Durchlauf warten, und nach `stop()` darf kein
 * weiterer beginnen.
 */
describe("OutboxPublishLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("wartet in stop() auf den laufenden Durchlauf", async () => {
    let finish: () => void = () => undefined;
    let runs = 0;
    const loop = new OutboxPublishLoop(
      () =>
        new Promise<void>((resolve) => {
          runs += 1;
          finish = resolve;
        }),
      500,
    );
    loop.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(runs).toBe(1);

    let stopped = false;
    const stopping = loop.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    finish();
    await stopping;
    expect(stopped).toBe(true);
  });

  it("startet nach stop() keinen weiteren Durchlauf", async () => {
    let runs = 0;
    const loop = new OutboxPublishLoop(async () => {
      runs += 1;
    }, 500);
    loop.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(runs).toBe(1);

    await loop.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runs).toBe(1);
  });

  it("ueberlappt zwei Durchlaeufe nicht", async () => {
    let finish: () => void = () => undefined;
    let runs = 0;
    const loop = new OutboxPublishLoop(
      () =>
        new Promise<void>((resolve) => {
          runs += 1;
          finish = resolve;
        }),
      500,
    );
    loop.start();
    await vi.advanceTimersByTimeAsync(1_600);
    expect(runs).toBe(1);

    finish();
    await vi.advanceTimersByTimeAsync(500);
    expect(runs).toBe(2);
    finish();
    await loop.stop();
  });

  it("meldet einen Fehler des Durchlaufs und laeuft weiter", async () => {
    const errors: unknown[] = [];
    let runs = 0;
    const loop = new OutboxPublishLoop(
      async () => {
        runs += 1;
        if (runs === 1) throw new Error("Datenbank weg");
      },
      500,
      (error) => errors.push(error),
    );
    loop.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runs).toBe(2);
    expect(errors).toHaveLength(1);
    await loop.stop();
  });
});
