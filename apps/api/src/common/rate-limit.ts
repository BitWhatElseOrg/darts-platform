import rateLimit from "@fastify/rate-limit";
import { HttpException, HttpStatus } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyRequest } from "fastify";

import type { ApplicationEnvironment } from "@darts-platform/config";

const RATE_LIMIT_WINDOW = "1 minute";
const PUBLIC_PATH_PREFIX = "/api/v1/public/";

/**
 * Routen, die ein Geheimnis ausgeben oder pruefen: die Einladung liefert ein
 * gueltiges Claim-Token zurueck, `accept` prueft eines, und die
 * Auth-Endpunkte pruefen Passwoerter (Audit B, I-6).
 */
const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  /^\/api\/v1\/organizations\/[^/]+\/invitations$/u,
  /^\/api\/v1\/invitations\/[^/]+\/accept$/u,
  /^\/api\/v1\/auth\/sign-in\//u,
  /^\/api\/v1\/auth\/sign-up\//u,
];

function pathOf(request: FastifyRequest): string {
  const queryIndex = request.url.indexOf("?");
  return queryIndex === -1 ? request.url : request.url.slice(0, queryIndex);
}

/**
 * Bewusste Grenze (Audit I-6, Teil 2): der Zaehler liegt im
 * Fastify-Prozessspeicher, nicht in Redis. Hinter mehreren
 * Railway-Instanzen greift er deshalb je Instanz statt geteilt. Das ist
 * bewusst so belassen: der verteilte Zaehler sitzt bei Better Auth genau auf
 * den Routen, fuer die der Audit ihn verlangt (`/sign-in/email`,
 * `/sign-up/email`, Task 3 / `auth-rate-limit-storage.ts`). Dieser
 * Fastify-Zaehler ist die grobe Bremse fuer die uebrigen Routen; ihn ueber
 * `ioredis` zu teilen, waere an dieser Stelle den Zusatzaufwand nicht wert.
 *
 * Zweite bewusste Grenze: auf `/api/v1/auth/**` greifen beide Bremsen. Wer
 * zuerst auslöst, bestimmt den Antwortkörper — Fastify antwortet im
 * einheitlichen Format, Better Auth mit seinem eigenen `{ "message": … }`.
 * Die Auth-Routen reichen ohnehin schon Better-Auth-Fehlerkörper unveraendert
 * durch (`auth.controller.ts`), die Unschaerfe ist dort also nicht neu.
 */
export async function registerRateLimit(
  app: NestFastifyApplication,
  environment: ApplicationEnvironment,
): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    hook: "onRequest",
    timeWindow: RATE_LIMIT_WINDOW,
    max: (request: FastifyRequest): number => {
      const path = pathOf(request);

      if (SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
        return environment.RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE;
      }

      if (path.startsWith(PUBLIC_PATH_PREFIX)) {
        return environment.RATE_LIMIT_PUBLIC_MAX_PER_MINUTE;
      }

      return environment.RATE_LIMIT_MAX_PER_MINUTE;
    },
    // `@fastify/rate-limit` wirft den Rueckgabewert aus einem
    // `onRequest`-Hook, der vor dem Nest-Routing laeuft. Trotzdem faengt
    // Nests globaler `ApiExceptionFilter` ihn ab — jede unbehandelte
    // Fastify-Anfrage laeuft durch denselben Filter. Der Filter erkennt aber
    // nur `HttpException`: ein einfaches Objekt landet in seinem
    // Unbekannt-Zweig (Status 500, Code `INTERNAL_ERROR`, eigene Felder
    // verworfen — empirisch geprueft). Deshalb wirft dieser Builder eine
    // `HttpException`; Status, Code und Nachricht kommen dann unveraendert
    // im einheitlichen Format heraus, samt Correlation-Id, die der Filter
    // selbst ergaenzt (AGENTS.md §15).
    errorResponseBuilder: () =>
      new HttpException(
        {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests. Try again in a minute.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
  });
}
