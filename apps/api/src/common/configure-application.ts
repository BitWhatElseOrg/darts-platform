import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import type { ApplicationEnvironment } from "@darts-platform/config";

import { ApiExceptionFilter } from "./api-exception.filter.js";
import { ApiLoggingInterceptor } from "./api-logging.interceptor.js";
import { registerRateLimit } from "./rate-limit.js";
import { registerSecurityHeaders } from "./security-headers.js";

/**
 * Browser senden Verstoss-Meldungen der Content-Security-Policy nicht als
 * `application/json`, sondern als `application/csp-report` (die Form von
 * `report-uri`) beziehungsweise `application/reports+json` (die Form von
 * `report-to`). Fastify kennt beide nicht und antwortete darauf mit 415, die
 * Meldung ginge verloren. Beide werden deshalb wie JSON gelesen.
 *
 * Ein unlesbarer Koerper ergibt `undefined` statt eines Fehlers: der Endpunkt
 * bestaetigt jede Meldung still (`csp-report.controller.ts`), und ein 400 auf
 * eine Browser-Meldung hilft niemandem.
 */
function registerCspReportContentTypes(app: NestFastifyApplication): void {
  const instance = app.getHttpAdapter().getInstance();
  for (const contentType of ["application/csp-report", "application/reports+json"]) {
    instance.addContentTypeParser(
      contentType,
      { parseAs: "string" },
      (_request, body, done) => {
        try {
          done(null, JSON.parse(typeof body === "string" ? body : body.toString("utf8")));
        } catch {
          done(null, undefined);
        }
      },
    );
  }
}

/**
 * Profilbilder kommen als roher Binärkörper (`PUT`, `Content-Type: image/*`),
 * nicht als Multipart und nicht als base64-JSON. Das spart ein Plugin, und
 * clientseitig ist es `fetch(url, { method: "PUT", body: blob })`. Die
 * Bytegrenze bleibt das Fastify-Standardlimit von 1 MB; die Fläche
 * verkleinert vorher im Browser.
 */
function registerImageUploadContentType(app: NestFastifyApplication): void {
  const instance = app.getHttpAdapter().getInstance();
  instance.addContentTypeParser(/^image\//u, { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
}

/**
 * Verkabelt die Produktions-Pipeline einer Nest-Fastify-Anwendung: CORS-
 * Allowlist, Sicherheits-Header, Rate-Limiting, globaler Fehlerfilter und
 * Logging-Interceptor — in dieser Reihenfolge, wie bisher in `main.ts`.
 * `main.ts` und der Test-Harness (`createApiTestApplication`) rufen exakt
 * diese Funktion auf, damit Tests dieselbe Pipeline durchlaufen wie die
 * echte Anwendung. `app.setGlobalPrefix(...)` und produktionsspezifische
 * Schritte wie `app.enableShutdownHooks()` bleiben bewusst ausserhalb — die
 * betreffen nicht die HTTP-Pipeline selbst und ergeben in einer nicht
 * lauschenden Testanwendung keinen Sinn.
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
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"],
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "X-Correlation-Id",
      "X-Dartbase-Invitation-Claim",
    ],
  });
  registerCspReportContentTypes(app);
  registerImageUploadContentType(app);
  await registerSecurityHeaders(app);
  await registerRateLimit(app, environment);
  app.useGlobalFilters(new ApiExceptionFilter(environment.TRUST_PROXY_HOPS));
  app.useGlobalInterceptors(
    new ApiLoggingInterceptor(
      new Logger("HTTP"),
      environment.LOG_CLIENT_ADDRESS,
      environment.TRUST_PROXY_HOPS,
    ),
  );
}
