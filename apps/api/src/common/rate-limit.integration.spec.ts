import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { apiErrorSchema } from "@darts-platform/schemas";

import { createApiTestApplication } from "../testing/api-harness.js";

let app: NestFastifyApplication;

beforeAll(async () => {
  // Drei Anfragen je Minute auf die oeffentlichen Routen: die vierte muss
  // gebremst werden, ohne dass der Test eine Minute lang warten muss.
  app = await createApiTestApplication({ RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: 3 });
}, 60_000);

afterAll(async () => {
  await app.close();
});

describe("Rate Limiting", () => {
  it("antwortet nach dem Ueberschreiten mit 429 im einheitlichen Fehlerformat", async () => {
    const url = `/api/v1/public/tournaments/${randomUUID()}/live`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const allowed = await app.inject({ method: "GET", url });
      expect(allowed.statusCode).not.toBe(429);
    }

    const blocked = await app.inject({ method: "GET", url });
    expect(blocked.statusCode).toBe(429);

    const payload: unknown = blocked.json();
    const parsed = apiErrorSchema.parse(payload);
    expect(parsed.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(parsed.error.message.length).toBeGreaterThan(0);
    expect(blocked.headers["retry-after"]).toBeDefined();
  }, 30_000);

  it("bremst den Health-Endpunkt nicht mit der oeffentlichen Grenze", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({ method: "GET", url: "/api/v1/health" });
      expect(response.statusCode).not.toBe(429);
    }
  }, 30_000);
});
