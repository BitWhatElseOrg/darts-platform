import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import type { ApplicationEnvironment } from "@darts-platform/config";

import { ApiExceptionFilter } from "./api-exception.filter.js";
import { ApiLoggingInterceptor } from "./api-logging.interceptor.js";
import { registerSecurityHeaders } from "./security-headers.js";

/**
 * Verkabelt die Produktions-Pipeline einer Nest-Fastify-Anwendung: CORS-
 * Allowlist, Sicherheits-Header, globaler Fehlerfilter und Logging-
 * Interceptor — in dieser Reihenfolge, wie bisher in `main.ts`. `main.ts`
 * und der Test-Harness (`createApiTestApplication`) rufen exakt diese
 * Funktion auf, damit Tests dieselbe Pipeline durchlaufen wie die echte
 * Anwendung. `app.setGlobalPrefix(...)` und produktionsspezifische Schritte
 * wie `app.enableShutdownHooks()` bleiben bewusst ausserhalb — die betreffen
 * nicht die HTTP-Pipeline selbst und ergeben in einer nicht lauschenden
 * Testanwendung keinen Sinn.
 *
 * TODO (spätere Aufgabe): `registerRateLimit(app, environment)` hier
 * ergänzen, sobald `@fastify/rate-limit` verkabelt wird.
 */
export async function configureApplication(
  app: NestFastifyApplication,
  environment: ApplicationEnvironment,
): Promise<void> {
  const trustedWebOrigins = [
    environment.WEB_ORIGIN,
    ...environment.WEB_ADDITIONAL_ORIGINS,
  ];

  app.enableCors({
    origin: trustedWebOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "X-Correlation-Id",
      "X-Dartbase-Invitation-Claim",
    ],
  });
  await registerSecurityHeaders(app);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ApiLoggingInterceptor(new Logger("HTTP")));
}
