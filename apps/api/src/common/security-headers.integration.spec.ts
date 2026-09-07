import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { parseApplicationEnvironment } from "@darts-platform/config";

import { createApiTestApplication } from "../testing/api-harness.js";

const environment = parseApplicationEnvironment(process.env);

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createApiTestApplication();
}, 60_000);

afterAll(async () => {
  await app.close();
});

describe("Security Headers", () => {
  it("liefert die Mindest-Header auf dem oeffentlichen Health-Endpunkt", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["strict-transport-security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["cross-origin-resource-policy"]).toBe("same-site");
    expect(response.headers["x-frame-options"]).toBe("DENY");
  }, 30_000);

  it("liefert eine Content-Security-Policy ohne jede Standardquelle (M4)", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });

    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
  }, 30_000);

  it("nennt keine Server-Kennung", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });

    expect(response.headers["x-powered-by"]).toBeUndefined();
  }, 30_000);

  it("erlaubt CORS fuer den erlaubten Web-Origin neben den Sicherheits-Headern", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { origin: environment.WEB_ORIGIN },
    });

    expect(response.headers["access-control-allow-origin"]).toBe(environment.WEB_ORIGIN);
  }, 30_000);
});
