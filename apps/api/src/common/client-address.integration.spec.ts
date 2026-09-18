import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { createApiTestApplication } from "../testing/api-harness.js";

let app: NestFastifyApplication;

afterEach(async () => {
  await app.close();
});

describe("Client-Adresse als Rate-Limit-Schlüssel", () => {
  it("nutzt hinter einem vertrauten Hop X-Real-IP und trennt Clients danach", async () => {
    app = await createApiTestApplication({ RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 1, TRUST_PROXY_HOPS: 1 });
    const url = `/api/v1/invitations/${randomUUID()}/accept`;
    const base = { method: "POST" as const, url, remoteAddress: "10.0.0.5" };

    expect((await app.inject({ ...base, headers: { "x-real-ip": "203.0.113.10" } })).statusCode).not.toBe(429);
    expect((await app.inject({ ...base, headers: { "x-real-ip": "203.0.113.10" } })).statusCode).toBe(429);
    expect((await app.inject({ ...base, headers: { "x-real-ip": "203.0.113.20" } })).statusCode).not.toBe(429);
  }, 30_000);

  it("ignoriert X-Real-IP ohne vertrauten Hop", async () => {
    app = await createApiTestApplication({ RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 1, TRUST_PROXY_HOPS: 0 });
    const url = `/api/v1/invitations/${randomUUID()}/accept`;
    const base = { method: "POST" as const, url, remoteAddress: "10.0.0.5" };

    expect((await app.inject({ ...base, headers: { "x-real-ip": "203.0.113.10" } })).statusCode).not.toBe(429);
    // Zweiter Client mit anderer X-Real-IP, aber derselben echten Adresse: derselbe Eimer.
    expect((await app.inject({ ...base, headers: { "x-real-ip": "203.0.113.20" } })).statusCode).toBe(429);
  }, 30_000);

  /**
   * Fallback-Pfad (Messung 18.09.2026): Railways interne Probe schickt weder
   * `x-real-ip` noch `x-forwarded-for` (beide `null`). Ohne `x-real-ip`
   * bleibt `request.ip` massgeblich, auch mit vertrautem Hop — zwei
   * verschiedene `remoteAddress`-Werte muessen dann in getrennte Eimer
   * fallen, derselbe Wert zweimal in denselben.
   */
  it("faellt ohne X-Real-IP auf request.ip zurueck, auch mit vertrautem Hop", async () => {
    app = await createApiTestApplication({ RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 1, TRUST_PROXY_HOPS: 1 });
    const url = `/api/v1/invitations/${randomUUID()}/accept`;

    expect(
      (await app.inject({ method: "POST", url, remoteAddress: "10.0.0.5" })).statusCode,
    ).not.toBe(429);
    expect(
      (await app.inject({ method: "POST", url, remoteAddress: "10.0.0.5" })).statusCode,
    ).toBe(429);
    expect(
      (await app.inject({ method: "POST", url, remoteAddress: "10.0.0.6" })).statusCode,
    ).not.toBe(429);
  }, 30_000);
});
