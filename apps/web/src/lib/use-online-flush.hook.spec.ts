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

/**
 * happy-dom liefert `navigator.onLine` fest als `true` -- ohne diesen Mock
 * loest bereits das Einhaengen in JEDEM Test einen Durchgang aus und die
 * Zaehlungen weiter unten, die gezielt das `online`-Ereignis pruefen wollen,
 * zaehlten den Einhaenge-Lauf mit.
 */
function mockOnline(value: boolean): void {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useOnlineFlush", () => {
  it("uebertraegt beim Online-Ereignis", async () => {
    mockOnline(false);
    const flush = vi.fn(async () => undefined);
    renderHook(() => { useOnlineFlush(flush); });

    await goOnline();

    expect(flush).toHaveBeenCalledOnce();
  });

  /**
   * Ruling E8/Mount-Flush: mirroring `use-match-scoring.ts` (~236-241) laeuft
   * die Uebertragung auch ohne `online`-Ereignis an, sobald das Geraet beim
   * Einhaengen bereits im Netz ist -- eine Warteschlange, die schon VOR dem
   * Betreten der Seite gefuellt war, wartete sonst auf das naechste Ereignis
   * oder den Knopf.
   */
  it("uebertraegt einmal beim Einhaengen, wenn online", async () => {
    mockOnline(true);
    const flush = vi.fn(async () => undefined);

    await act(async () => {
      renderHook(() => { useOnlineFlush(flush); });
      await Promise.resolve();
    });

    expect(flush).toHaveBeenCalledOnce();
  });

  it("uebertraegt nicht beim Einhaengen, wenn offline", async () => {
    mockOnline(false);
    const flush = vi.fn(async () => undefined);

    await act(async () => {
      renderHook(() => { useOnlineFlush(flush); });
      await Promise.resolve();
    });

    expect(flush).not.toHaveBeenCalled();
  });

  /**
   * Zwei Ereignisse kurz hintereinander -- ein flackernder Uplink -- duerfen
   * keinen zweiten Durchgang auf derselben Warteschlange starten: die
   * Reihenfolge der Kette waere dahin. Dasselbe Motiv wie `replayingRef` in
   * `use-match-scoring.ts`.
   */
  it("startet keinen zweiten Durchgang, solange der erste laeuft", async () => {
    mockOnline(false);
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
    mockOnline(false);
    const flush = vi.fn(async () => { throw new Error("Netz weg"); });
    renderHook(() => { useOnlineFlush(flush); });

    await goOnline();
    await goOnline();

    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("ruft die jeweils aktuelle Fassung", async () => {
    mockOnline(false);
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
    mockOnline(false);
    const flush = vi.fn(async () => undefined);
    const view = renderHook(() => { useOnlineFlush(flush); });

    view.unmount();
    await goOnline();

    expect(flush).not.toHaveBeenCalled();
  });
});
