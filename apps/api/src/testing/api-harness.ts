import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";

import {
  parseApplicationEnvironment,
  type ApplicationEnvironment,
} from "@darts-platform/config";

import { AppModule } from "../app.module.js";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { registerSecurityHeaders } from "../common/security-headers.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";

/**
 * Baut die echte Anwendung — dieselben Module, derselbe globale Prefix,
 * derselbe Fehlerfilter, dieselben Fastify-Plugins wie in `main.ts` — und
 * gibt sie initialisiert, aber nicht lauschend zurueck. Tests befragen sie
 * ueber `app.inject(...)`. Ueber `overrides` laesst sich die Umgebung
 * punktuell veraendern, ohne `process.env` anzufassen.
 *
 * Aufrufer schliesst die Anwendung im `afterAll` mit `await app.close()`;
 * das faehrt Datenbank- und Redis-Verbindungen mit herunter.
 */
export async function createApiTestApplication(
  overrides: Partial<ApplicationEnvironment> = {},
): Promise<NestFastifyApplication> {
  const environment: ApplicationEnvironment = {
    ...parseApplicationEnvironment(process.env),
    ...overrides,
  };
  const moduleReference = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APPLICATION_ENVIRONMENT)
    .useValue(environment)
    .compile();
  const app = moduleReference.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );

  app.setGlobalPrefix("api/v1");
  await registerSecurityHeaders(app);
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
