// @vitest-environment happy-dom
//
// Konvention aus Tier 1 (siehe `display-key-storage.spec.ts`): die schnelle
// Suite in `src` laeuft in der Node-Umgebung, dieser Test braucht aber
// `window.localStorage` -- die Pragma-Zeile stellt sie nur fuer diese Datei
// bereit.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { forgetBoardDevice, recallBoardDevice, rememberBoardDevice, type StoredBoardDevice } from "./device-key-storage";

const device: StoredBoardDevice = {
  secret: "bd_geheim",
  boardName: "Board 1",
  organizationName: "VFC Beispiel",
};

describe("Geraeteschluessel eines Scheiben-Tablets", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
});
