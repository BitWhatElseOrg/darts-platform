import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createClient, type RedisClientType } from "redis";

import { parseApplicationEnvironment } from "@darts-platform/config";

import { createApiTestApplication } from "../testing/api-harness.js";

let app: NestFastifyApplication;
let redis: RedisClientType;

/**
 * Zufaellige Adressen aus den Dokumentationsbereichen: die Zaehler liegen in
 * Redis und ueberleben den Testlauf, ein fester Wert waere beim zweiten Lauf
 * schon vorhanden.
 */
const octet = (): number => 2 + Math.floor(Math.random() * 250);
const clientAddress = `203.0.113.${octet()}`;
const spoofedAddress = `198.51.100.${octet()}`;

beforeAll(async () => {
  app = await createApiTestApplication({
    TRUST_PROXY_HOPS: 1,
    // Nichts soll hier bremsen; geprueft wird allein, unter welchem
    // Schluessel gezaehlt wird.
    RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 100_000,
  });
  redis = createClient({
    url: parseApplicationEnvironment(process.env).REDIS_URL,
  }) as RedisClientType;
  await redis.connect();
}, 60_000);

afterAll(async () => {
  await app.close();
  await redis.quit();
});

/**
 * Better Auth loest die Client-Adresse selbst aus `X-Forwarded-For` auf und
 * verwirft eine mehrteilige Kette (`getIPFromHeader` in
 * `@better-auth/core`), solange keine vertrauten Proxys konfiguriert sind:
 * alle diese Anfragen landeten dann im gemeinsamen Eimer `no-trusted-ip`.
 * Railways Edge-Adressen sind nicht als CIDR-Liste bekannt, deshalb bekommt
 * Better Auth die Adresse, die Fastify ueber `TRUST_PROXY_HOPS` bereits
 * ermittelt hat, in einem eigenen Header.
 */
describe("Client-Adresse fuer Better Auth", () => {
  it("zaehlt unter der ueber vertraute Hops ermittelten Adresse, auch bei mehrteiligem X-Forwarded-For", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in/email",
      remoteAddress: "10.0.0.5",
      headers: {
        // Der erste Eintrag stammt vom Client selbst, der zweite von unserem
        // einen vertrauten Hop.
        "x-forwarded-for": `9.9.9.9, ${clientAddress}`,
        // Ein selbst mitgeschickter Header darf nicht durchkommen.
        "x-dartbase-client-ip": spoofedAddress,
      },
      payload: { email: "niemand@example.test", password: "falsches-passwort" },
    });

    // Die Anmeldung scheitert erwartungsgemaess; entscheidend ist der Zaehler.
    expect(response.statusCode).not.toBe(429);
    await expect(
      redis.exists(`rate-limit:auth:${clientAddress}|/sign-in/email`),
    ).resolves.toBe(1);
    await expect(
      redis.exists(`rate-limit:auth:${spoofedAddress}|/sign-in/email`),
    ).resolves.toBe(0);
  }, 30_000);
});
