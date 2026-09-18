import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";

import { parseApplicationEnvironment, type ApplicationEnvironment } from "@darts-platform/config";

import { AppModule } from "../app.module.js";
import { configureApplication } from "../common/configure-application.js";
import { resolveTrustProxyOption } from "../common/trust-proxy.js";
import { APPLICATION_ENVIRONMENT } from "../config/environment.module.js";

/**
 * Ein einzelner Routeneintrag, wie ihn der Fastify-`onRoute`-Hook meldet:
 * HTTP-Methode und vollstaendiger, praefigierter Pfad (`/api/v1/...`).
 */
export interface RouteEntry {
  readonly method: string;
  readonly url: string;
}

/**
 * Baut dieselbe Anwendung wie `createApiTestApplication`
 * (`api-harness.ts`), registriert aber vor `app.init()` einen
 * `onRoute`-Hook auf der zugrundeliegenden Fastify-Instanz, um jede
 * registrierte Route einzusammeln. Der Hook muss vor `init()` sitzen, weil
 * Fastify Routen erst beim Aufbau des Anwendungsbaums meldet — danach ist es
 * zu spaet, sie abzugreifen.
 *
 * `HEAD`- und `OPTIONS`-Eintraege werden herausgefiltert: Fastify erzeugt
 * sie automatisch zu jeder `GET`- beziehungsweise sonstigen Route und sie
 * sind kein eigenstaendiges, von der Anwendung definiertes Verhalten.
 *
 * Aufrufer schliessen die Anwendung im `afterAll` mit `await app.close()`,
 * wie bei `createApiTestApplication`.
 */
export async function collectRoutes(
  overrides: Partial<ApplicationEnvironment> = {},
): Promise<{ app: NestFastifyApplication; routes: readonly RouteEntry[] }> {
  const environment: ApplicationEnvironment = {
    ...parseApplicationEnvironment(process.env),
    ...overrides,
  };
  const moduleReference = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APPLICATION_ENVIRONMENT)
    .useValue(environment)
    .compile();
  const app = moduleReference.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({
      trustProxy: resolveTrustProxyOption(environment.TRUST_PROXY_HOPS),
    }),
    { logger: false },
  );

  const routes: RouteEntry[] = [];
  app.getHttpAdapter().getInstance().addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === "HEAD" || method === "OPTIONS") continue;
      routes.push({ method, url: route.url });
    }
  });

  app.setGlobalPrefix("api/v1");
  await configureApplication(app, environment);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return { app, routes };
}
