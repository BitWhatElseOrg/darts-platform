import { describe, expect, it } from "vitest";

import {
  StructuredLogger,
  type LogDestination,
} from "./structured-logger.js";

describe("StructuredLogger", () => {
  it("writes machine-readable records with context", () => {
    const records: Array<{ destination: LogDestination; record: string }> = [];
    const logger = new StructuredLogger("api", "log", (destination, record) => {
      records.push({ destination, record });
    });

    logger.log(
      { event: "http_request_completed", correlationId: "test-correlation" },
      "HTTP",
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.destination).toBe("stdout");
    expect(JSON.parse(records[0]?.record ?? "{}")).toMatchObject({
      level: "log",
      service: "api",
      event: "http_request_completed",
      correlationId: "test-correlation",
      context: "HTTP",
    });
  });

  it("filters records below the configured level and sends errors to stderr", () => {
    const records: Array<{ destination: LogDestination; record: string }> = [];
    const logger = new StructuredLogger("api", "warn", (destination, record) => {
      records.push({ destination, record });
    });

    logger.log("not written");
    logger.error(new Error("boom"), "Test");

    expect(records).toHaveLength(1);
    expect(records[0]?.destination).toBe("stderr");
    expect(JSON.parse(records[0]?.record ?? "{}")).toMatchObject({
      level: "error",
      message: "boom",
      errorName: "Error",
      context: "Test",
    });
  });
});
