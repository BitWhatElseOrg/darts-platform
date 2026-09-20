import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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

  it("bremst den Health-Endpunkt nicht mit der oeffentlichen Grenze und zaehlt ihn gar nicht erst mit", async () => {
    let lastResponse;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      lastResponse = await app.inject({ method: "GET", url: "/api/v1/health" });
      expect(lastResponse.statusCode).not.toBe(429);
    }

    // Health steht in der `allowList`: die Anfrage verlaesst den Limiter,
    // bevor irgendein Zaehler-Header gesetzt wird.
    expect(lastResponse?.headers["x-ratelimit-limit"]).toBeUndefined();
  }, 30_000);
});

describe("Rate Limiting je Stufe und Client", () => {
  let isolatedApp: NestFastifyApplication;

  afterEach(async () => {
    await isolatedApp.close();
  });

  it("teilt die allgemeine und die sensible Stufe nicht denselben Eimer", async () => {
    isolatedApp = await createApiTestApplication({
      RATE_LIMIT_MAX_PER_MINUTE: 1,
      RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 1,
    });
    const generalUrl = "/api/v1/organizations";
    const sensitiveUrl = `/api/v1/invitations/${randomUUID()}/accept`;

    // Die allgemeine Stufe ist nach einer Anfrage ausgeschoepft ...
    const firstGeneral = await isolatedApp.inject({ method: "GET", url: generalUrl });
    expect(firstGeneral.statusCode).not.toBe(429);
    const secondGeneral = await isolatedApp.inject({ method: "GET", url: generalUrl });
    expect(secondGeneral.statusCode).toBe(429);

    // ... die sensible Stufe ist davon unberuehrt und hat ihr eigenes Budget.
    const firstSensitive = await isolatedApp.inject({ method: "POST", url: sensitiveUrl });
    expect(firstSensitive.statusCode).not.toBe(429);

    // Und umgekehrt: die jetzt ausgeschoepfte sensible Stufe bremst die
    // allgemeine Stufe nicht zusaetzlich.
    const secondSensitive = await isolatedApp.inject({ method: "POST", url: sensitiveUrl });
    expect(secondSensitive.statusCode).toBe(429);
  }, 30_000);

  it("trennt Zaehler nach der ueber vertraute Proxy-Hops ermittelten Client-Adresse", async () => {
    isolatedApp = await createApiTestApplication({
      RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 1,
      TRUST_PROXY_HOPS: 1,
    });
    const url = `/api/v1/invitations/${randomUUID()}/accept`;
    // Railways Edge-Proxy waere der eine vertraute Hop; die injizierten
    // Anfragen kommen "von dort" mit je einer eigenen Client-Adresse in
    // `X-Forwarded-For`.
    const remoteAddress = "10.0.0.5";
    const firstClient = { "x-forwarded-for": "203.0.113.10" };
    const secondClient = { "x-forwarded-for": "203.0.113.20" };

    const firstAllowed = await isolatedApp.inject({
      method: "POST",
      url,
      headers: firstClient,
      remoteAddress,
    });
    expect(firstAllowed.statusCode).not.toBe(429);

    const firstBlocked = await isolatedApp.inject({
      method: "POST",
      url,
      headers: firstClient,
      remoteAddress,
    });
    expect(firstBlocked.statusCode).toBe(429);

    // Anderer Client hinter demselben Hop: eigenes, noch unberuehrtes Budget.
    const secondAllowed = await isolatedApp.inject({
      method: "POST",
      url,
      headers: secondClient,
      remoteAddress,
    });
    expect(secondAllowed.statusCode).not.toBe(429);
  }, 30_000);
});

describe("Stufenzuordnung je Route (Ruling B14)", () => {
  let isolatedApp: NestFastifyApplication;

  beforeAll(async () => {
    // Zwei deutlich unterschiedliche Obergrenzen: die Zaehler-Kopfzeile
    // verraet zuverlaessig, welche Stufe eine Route tatsaechlich traegt, ohne
    // die Grenze erst ausschoepfen zu muessen.
    isolatedApp = await createApiTestApplication({
      RATE_LIMIT_MAX_PER_MINUTE: 42,
      RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 7,
    });
  }, 60_000);

  afterAll(async () => {
    await isolatedApp.close();
  });

  it("ordnet das Ausstellen einer Einladung der allgemeinen Stufe zu", async () => {
    const response = await isolatedApp.inject({
      method: "POST",
      url: `/api/v1/organizations/${randomUUID()}/invitations`,
      payload: {},
    });

    expect(response.headers["x-ratelimit-limit"]).toBe("42");
  }, 30_000);

  it("belaesst die Annahme einer Einladung auf der sensiblen Stufe", async () => {
    const response = await isolatedApp.inject({
      method: "POST",
      url: `/api/v1/invitations/${randomUUID()}/accept`,
      payload: {},
    });

    expect(response.headers["x-ratelimit-limit"]).toBe("7");
  }, 30_000);

  // Je Stufe ein eigener Fall statt einer Schleife ueber mehrere Pfade: der
  // Zaehler-Schluessel ist `<stufe>:<adresse>` ohne Pfad, mehrere sensible
  // Pfade in einem Fall teilten sich also den Eimer und schoepften die Grenze
  // aus, statt nur die Kopfzeile zu pruefen.
  it("ordnet die Einladungsvorschau der sensiblen Stufe zu", async () => {
    const response = await isolatedApp.inject({
      method: "POST",
      url: `/api/v1/invitations/${randomUUID()}/preview`,
      payload: {},
    });

    expect(response.headers["x-ratelimit-limit"]).toBe("7");
  }, 30_000);

  it("ordnet das erneute Senden einer Einladung der sensiblen Stufe zu", async () => {
    const response = await isolatedApp.inject({
      method: "POST",
      url: `/api/v1/organizations/${randomUUID()}/invitations/${randomUUID()}/resend`,
      payload: {},
    });

    expect(response.headers["x-ratelimit-limit"]).toBe("7");
  }, 30_000);

  it("belaesst Anmeldung und Registrierung auf der sensiblen Stufe", async () => {
    const signIn = await isolatedApp.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in/email",
      payload: {},
    });
    expect(signIn.headers["x-ratelimit-limit"]).toBe("7");

    const signUp = await isolatedApp.inject({
      method: "POST",
      url: "/api/v1/auth/sign-up/email",
      payload: {},
    });
    expect(signUp.headers["x-ratelimit-limit"]).toBe("7");
  }, 30_000);

  // Better Auth haengt unter der Platzhalter-Route des `AuthController`; die
  // Fastify-Bremse sieht den vollen Pfad und greift dort genauso wie bei
  // Anmeldung und Registrierung (Spec 2026-09-20-email-versand).
  it("ordnet die Reset-Anforderung der sensiblen Stufe zu", async () => {
    const response = await isolatedApp.inject({
      method: "POST",
      url: "/api/v1/auth/request-password-reset",
      payload: {},
    });

    expect(response.headers["x-ratelimit-limit"]).toBe("7");
  }, 30_000);
});
