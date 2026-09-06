// @vitest-environment happy-dom
//
// Konvention aus Tier 1: Hook-Tests heissen `*.hook.spec.ts` und holen sich das
// DOM ueber die Pragma-Zeile, damit die uebrige Suite in der schnellen
// Node-Umgebung bleibt (siehe `use-offline-queue.hook.spec.ts`).
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useOnlineFlush } from "./use-online-flush";

/** Ein Versprechen, das der Test selbst aufloest. */
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = () => { done(); };
  });
  return { promise, resolve };
}

async function goOnline(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useOnlineFlush", () => {
  it("uebertraegt beim Online-Ereignis", async () => {
    const flush = vi.fn(async () => undefined);
    renderHook(() => { useOnlineFlush(flush); });

    await goOnline();

    expect(flush).toHaveBeenCalledOnce();
  });

  /**
   * Zwei Ereignisse kurz hintereinander -- ein flackernder Uplink -- duerfen
   * keinen zweiten Durchgang auf derselben Warteschlange starten: die
   * Reihenfolge der Kette waere dahin. Dasselbe Motiv wie `replayingRef` in
   * `use-match-scoring.ts`.
   */
  it("startet keinen zweiten Durchgang, solange der erste laeuft", async () => {
    const gate = deferred();
    const flush = vi.fn(async () => await gate.promise);
    renderHook(() => { useOnlineFlush(flush); });

    await goOnline();
    await goOnline();
    expect(flush).toHaveBeenCalledOnce();

    await act(async () => { gate.resolve(); await gate.promise; });
    await goOnline();
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("startet nach einem gescheiterten Durchgang wieder", async () => {
    const flush = vi.fn(async () => { throw new Error("Netz weg"); });
    renderHook(() => { useOnlineFlush(flush); });

    await goOnline();
    await goOnline();

    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("ruft die jeweils aktuelle Fassung", async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const view = renderHook(({ flush }: { flush: () => Promise<void> }) => { useOnlineFlush(flush); }, {
      initialProps: { flush: first },
    });

    view.rerender({ flush: second });
    await goOnline();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("hoert beim Abmelden auf", async () => {
    const flush = vi.fn(async () => undefined);
    const view = renderHook(() => { useOnlineFlush(flush); });

    view.unmount();
    await goOnline();

    expect(flush).not.toHaveBeenCalled();
  });
});
