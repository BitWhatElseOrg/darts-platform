// @vitest-environment happy-dom
//
// Konvention aus Tier 1 (siehe `display-key-storage.spec.ts`): die schnelle
// Suite in `src` laeuft in der Node-Umgebung, dieser Test braucht aber
// `window.localStorage` -- die Pragma-Zeile stellt sie nur fuer diese Datei
// bereit.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetBoardDevice,
  getBoardDeviceSnapshot,
  recallBoardDevice,
  rememberBoardDevice,
  subscribeBoardDeviceChanges,
  type StoredBoardDevice,
} from "./device-key-storage";

const device: StoredBoardDevice = {
  secret: "bd_geheim",
  boardName: "Board 1",
  organizationName: "VFC Beispiel",
};

describe("Geraeteschluessel eines Scheiben-Tablets", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  // Ohne dieses Aufraeumen blieb ein `vi.spyOn(Storage.prototype, …)` aus
  // einem der Faelle unten (etwa "bleibt ruhig, wenn der Browser das Ablegen
  // verweigert") ueber das Testende hinaus wirksam und liess spaetere,
  // eigentlich unbeteiligte Faelle mit demselben (kaputten) Zugriff laufen --
  // genau das legten die neuen `getBoardDeviceSnapshot`-Faelle unten offen.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("merkt sich das Geraet und liest es zurueck", () => {
    rememberBoardDevice(device);

    expect(recallBoardDevice()).toEqual(device);
  });

  it("kennt ohne gemerktes Geraet nichts", () => {
    expect(recallBoardDevice()).toBeNull();
  });

  it("vergisst ein gemerktes Geraet", () => {
    rememberBoardDevice(device);
    forgetBoardDevice();

    expect(recallBoardDevice()).toBeNull();
  });

  it("liest einen kaputten JSON-Wert als nichts Gemerktes", () => {
    window.localStorage.setItem("dartbase.board-device", "{ kaputt");

    expect(recallBoardDevice()).toBeNull();
  });

  it("liest einen Wert ohne gueltigen Geraeteschluessel als nichts Gemerktes", () => {
    window.localStorage.setItem("dartbase.board-device", JSON.stringify({ secret: "kein-bd-praefix", boardName: "x", organizationName: "y" }));

    expect(recallBoardDevice()).toBeNull();
  });

  it("bleibt ruhig, wenn der Browser das Ablegen verweigert", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Zugriff verweigert");
    });

    expect(() => rememberBoardDevice(device)).not.toThrow();
    expect(recallBoardDevice()).toBeNull();
  });

  it("bleibt ruhig, wenn der Browser das Lesen verweigert", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Zugriff verweigert");
    });

    expect(recallBoardDevice()).toBeNull();
  });

  it("bleibt ruhig, wenn der Browser das Vergessen verweigert", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("Zugriff verweigert");
    });

    expect(() => forgetBoardDevice()).not.toThrow();
  });

  // Task 12, Review-Fix Hydration: `useSyncExternalStore` vergleicht per
  // `Object.is` -- ein neues Objekt bei unveraendertem Rohwert liesse React
  // in einer Schleife neu rendern.
  describe("getBoardDeviceSnapshot", () => {
    it("liefert ohne gemerktes Geraet null", () => {
      expect(getBoardDeviceSnapshot()).toBeNull();
    });

    it("liefert dieselbe Objektreferenz, solange sich der Rohwert nicht aendert", () => {
      rememberBoardDevice(device);

      const first = getBoardDeviceSnapshot();
      const second = getBoardDeviceSnapshot();

      expect(first).toEqual(device);
      expect(second).toBe(first);
    });

    it("liefert eine neue Referenz, sobald sich der Rohwert aendert", () => {
      rememberBoardDevice(device);
      const first = getBoardDeviceSnapshot();

      const other: StoredBoardDevice = { ...device, boardName: "Board 2" };
      rememberBoardDevice(other);
      const second = getBoardDeviceSnapshot();

      expect(second).toEqual(other);
      expect(second).not.toBe(first);
    });
  });

  describe("subscribeBoardDeviceChanges", () => {
    it("meldet ein natives storage-Ereignis für diesen Schlüssel", () => {
      const onChange = vi.fn();
      const unsubscribe = subscribeBoardDeviceChanges(onChange);

      window.dispatchEvent(new StorageEvent("storage", { key: "dartbase.board-device" }));
      expect(onChange).toHaveBeenCalledTimes(1);

      unsubscribe();
      window.dispatchEvent(new StorageEvent("storage", { key: "dartbase.board-device" }));
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("ignoriert storage-Ereignisse anderer Schlüssel", () => {
      const onChange = vi.fn();
      subscribeBoardDeviceChanges(onChange);

      window.dispatchEvent(new StorageEvent("storage", { key: "dartbase.display-key.irgendein-turnier" }));
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
