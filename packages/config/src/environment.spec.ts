import { describe, expect, it } from "vitest";

import {
  EnvironmentValidationError,
  parseApplicationEnvironment,
  parsePublicWebEnvironment,
} from "./environment";

const validEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://darts:darts@localhost:5432/darts",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_SECRET: "test-only-better-auth-secret-with-32-characters",
  BETTER_AUTH_URL: "http://localhost:3001",
  WEB_PORT: "3000",
  API_PORT: "3001",
  PORT: "4001",
  WEB_ORIGIN: "http://localhost:3000",
  LOG_LEVEL: "warn",
} as const;

describe("parseApplicationEnvironment", () => {
  it("parses and coerces a valid environment", () => {
    const environment = parseApplicationEnvironment(validEnvironment);

    expect(environment).toMatchObject({
      NODE_ENV: "test",
      WEB_PORT: 3000,
      API_PORT: 3001,
      PORT: 4001,
      LOG_LEVEL: "warn",
    });
  });

  it("parses additional trusted web origins as an explicit URL allowlist", () => {
    const environment = parseApplicationEnvironment({
      ...validEnvironment,
      WEB_ADDITIONAL_ORIGINS:
        "https://www.dartbase.ch, https://verein.dartbase.ch",
    });

    expect(environment.WEB_ADDITIONAL_ORIGINS).toEqual([
      "https://www.dartbase.ch",
      "https://verein.dartbase.ch",
    ]);
  });

  it("reports every invalid required value", () => {
    expect(() =>
      parseApplicationEnvironment({
        ...validEnvironment,
        DATABASE_URL: undefined,
        REDIS_URL: "http://localhost:6379",
        API_PORT: "70000",
      }),
    ).toThrow(EnvironmentValidationError);

    try {
      parseApplicationEnvironment({
        ...validEnvironment,
        DATABASE_URL: undefined,
        REDIS_URL: "http://localhost:6379",
        API_PORT: "70000",
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      expect((error as EnvironmentValidationError).message).toContain("DATABASE_URL");
      expect((error as EnvironmentValidationError).message).toContain("REDIS_URL");
      expect((error as EnvironmentValidationError).message).toContain("API_PORT");
    }
  });

  it("erlaubt eine TLS-Redis-Verbindung", () => {
    const environment = parseApplicationEnvironment({
      ...validEnvironment,
      REDIS_URL: "rediss://cache.example.test:6380",
    });

    expect(environment.REDIS_URL).toBe("rediss://cache.example.test:6380");
  });

  it("weist ein Redis-Schema ausserhalb von redis und rediss ab", () => {
    expect(() =>
      parseApplicationEnvironment({
        ...validEnvironment,
        REDIS_URL: "http://localhost:6379",
      }),
    ).toThrow(EnvironmentValidationError);
  });

  it("setzt die Rate-Limit-Vorgaben, wenn nichts konfiguriert ist", () => {
    const environment = parseApplicationEnvironment(validEnvironment);

    expect(environment.RATE_LIMIT_MAX_PER_MINUTE).toBe(300);
    expect(environment.RATE_LIMIT_PUBLIC_MAX_PER_MINUTE).toBe(120);
    expect(environment.RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE).toBe(10);
  });

  it("uebernimmt konfigurierte Rate-Limit-Werte als Zahlen", () => {
    const environment = parseApplicationEnvironment({
      ...validEnvironment,
      RATE_LIMIT_MAX_PER_MINUTE: "50",
      RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: "20",
      RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: "3",
    });

    expect(environment.RATE_LIMIT_MAX_PER_MINUTE).toBe(50);
    expect(environment.RATE_LIMIT_PUBLIC_MAX_PER_MINUTE).toBe(20);
    expect(environment.RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE).toBe(3);
  });
});

describe("parsePublicWebEnvironment", () => {
  it("requires a valid public API URL", () => {
    expect(() => parsePublicWebEnvironment({})).toThrow(
      EnvironmentValidationError,
    );

    expect(
      parsePublicWebEnvironment({
        NEXT_PUBLIC_API_URL: "http://localhost:3001/api/v1",
      }),
    ).toEqual({
      NEXT_PUBLIC_API_URL: "http://localhost:3001/api/v1",
    });
  });
});
