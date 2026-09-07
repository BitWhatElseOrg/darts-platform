import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiTestApplication } from "../testing/api-harness.js";

/**
 * Der Endpunkt laeuft durch dieselbe Pipeline wie in der Produktion — er muss
 * ohne Anmeldung erreichbar sein (der Browser sendet keine), und er muss die
 * beiden Meldeformate annehmen, die Fastify von sich aus nicht kennt.
 */
describe("POST /api/v1/csp-reports", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApiTestApplication();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it("nimmt die alte report-uri-Form ohne Anmeldung an", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/csp-reports",
      headers: { "content-type": "application/csp-report" },
      payload: JSON.stringify({
        "csp-report": {
          "document-uri": "https://dartbase.ch/matches",
          "effective-directive": "script-src",
          "blocked-uri": "https://fremd.example/tracker.js",
        },
      }),
    });

    expect(response.statusCode).toBe(204);
  }, 30_000);

  it("nimmt die Reporting-API-Form an", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/csp-reports",
      headers: { "content-type": "application/reports+json" },
      payload: JSON.stringify([
        {
          type: "csp-violation",
          url: "https://dartbase.ch/liga",
          body: { documentURL: "https://dartbase.ch/liga", effectiveDirective: "connect-src" },
        },
      ]),
    });

    expect(response.statusCode).toBe(204);
  }, 30_000);

  /**
   * Die Reporting-API schickt fuer einen fremden Ursprung erst eine
   * Vorabanfrage. Scheitert sie, kommt die Meldung nie an — und die Policy
   * meldete ins Leere, ohne dass es jemandem auffiele.
   */
  it("beantwortet die Vorabanfrage der Weboberflaeche", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/csp-reports",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

    expect(response.statusCode).toBeLessThan(300);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(String(response.headers["access-control-allow-headers"]).toLowerCase()).toContain("content-type");
  }, 30_000);

  it("bestaetigt auch einen unlesbaren Koerper still", async () => {
    for (const payload of ["kein json", JSON.stringify({ irgendwas: true })]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/csp-reports",
        headers: { "content-type": "application/csp-report" },
        payload,
      });
      expect(response.statusCode).toBe(204);
    }
  }, 30_000);
});
