import { describe, expect, it } from "vitest";

import {
  applicationLogLevels,
  createStructuredLogEmitter,
  type LogDestination,
} from "./structured-logger";

describe("createStructuredLogEmitter", () => {
  it("schreibt einen maschinenlesbaren Record nach stdout", () => {
    const records: Array<{ destination: LogDestination; record: string }> = [];
    const emitter = createStructuredLogEmitter("worker", "log", (destination, record) => {
      records.push({ destination, record });
    });

    emitter.emit("log", { event: "statistics.event_processed", eventId: "abc" });

    expect(records).toHaveLength(1);
    expect(records[0]?.destination).toBe("stdout");
    expect(JSON.parse(records[0]?.record ?? "{}")).toMatchObject({
      level: "log",
      service: "worker",
      event: "statistics.event_processed",
      eventId: "abc",
    });
  });

  it("filtert unterhalb der Schwelle und schickt Fehler nach stderr", () => {
    const records: Array<{ destination: LogDestination; record: string }> = [];
    const emitter = createStructuredLogEmitter("worker", "warn", (destination, record) => {
      records.push({ destination, record });
    });

    emitter.emit("debug", { event: "ignoriert" });
    emitter.emit("error", { event: "outbox.dead_letter" });

    expect(records).toHaveLength(1);
    expect(records[0]?.destination).toBe("stderr");
    expect(JSON.parse(records[0]?.record ?? "{}")).toMatchObject({
      level: "error",
      event: "outbox.dead_letter",
    });
  });

  it("führt genau die Level der Umgebungsvariablen", () => {
    expect([...applicationLogLevels]).toEqual([
      "fatal",
      "error",
      "warn",
      "log",
      "debug",
      "verbose",
    ]);
  });
});
