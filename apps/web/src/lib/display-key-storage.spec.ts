// @vitest-environment happy-dom
//
// Konvention aus Tier 1 (siehe `use-offline-queue.hook.spec.ts`): die
// schnelle Suite in `src` laeuft in der Node-Umgebung, dieser Test braucht
// aber `window.localStorage` -- die Pragma-Zeile stellt sie nur fuer diese
// Datei bereit.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { recallDisplayKey, rememberDisplayKey } from "./display-key-storage";

describe("Anzeige-Schluessel im Browser", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("merkt sich den Schluessel je Turnier", () => {
    rememberDisplayKey("turnier-a", "geheim-a");
    rememberDisplayKey("turnier-b", "geheim-b");

    expect(recallDisplayKey("turnier-a")).toBe("geheim-a");
    expect(recallDisplayKey("turnier-b")).toBe("geheim-b");
  });

  it("kennt zu einem fremden Turnier nichts", () => {
    expect(recallDisplayKey("turnier-c")).toBeNull();
  });

  it("bleibt ruhig, wenn der Browser die Ablage verweigert", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Zugriff verweigert");
    });

    expect(() => rememberDisplayKey("turnier-d", "geheim-d")).not.toThrow();
    expect(recallDisplayKey("turnier-d")).toBeNull();
  });
});
