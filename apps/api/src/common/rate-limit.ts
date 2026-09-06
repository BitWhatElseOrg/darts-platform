import rateLimit from "@fastify/rate-limit";
import { HttpException, HttpStatus } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyRequest } from "fastify";

import type { ApplicationEnvironment } from "@darts-platform/config";

const RATE_LIMIT_WINDOW = "1 minute";
const PUBLIC_PATH_PREFIX = "/api/v1/public/";
const HEALTH_PATH = "/api/v1/health";

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

type RateLimitTier = "general" | "public" | "sensitive";

function pathOf(request: FastifyRequest): string {
  const queryIndex = request.url.indexOf("?");
  return queryIndex === -1 ? request.url : request.url.slice(0, queryIndex);
}

/**
 * Stufeneinteilung je Pfad. Dieselbe Klassifizierung entscheidet sowohl die
 * Obergrenze (`max`) als auch den Zaehler-Schluessel (`keyGenerator`) —
 * beide muessen denselben Pfad derselben Stufe zuordnen, sonst zaehlen
 * unterschiedliche Grenzen gegen denselben Eimer (siehe Modul-Kommentar).
 */
function resolveRateLimitTier(path: string): RateLimitTier {
  if (SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    return "sensitive";
  }

  if (path.startsWith(PUBLIC_PATH_PREFIX)) {
    return "public";
  }

  return "general";
}

function maxFor(tier: RateLimitTier, environment: ApplicationEnvironment): number {
  if (tier === "sensitive") {
    return environment.RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE;
  }

  if (tier === "public") {
    return environment.RATE_LIMIT_PUBLIC_MAX_PER_MINUTE;
  }

  return environment.RATE_LIMIT_MAX_PER_MINUTE;
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
 * Der Zaehler-Schluessel ist `"<stufe>:<ip>"` statt nur der IP-Adresse: ohne
 * die Stufe im Schluessel teilten sich alle drei Stufen einen einzigen
 * Eimer je IP, und wer die allgemeine Grenze ausschoepft, waere faelschlich
 * auch von der sensiblen Grenze blockiert (und umgekehrt). `request.ip`
 * beruecksichtigt `TRUST_PROXY_HOPS` (`trust-proxy.ts`) — ohne vertrauten
 * Hop waeren hinter Railway alle Clients dieselbe Adresse und teilten sich
 * ohnehin einen Eimer je Stufe.
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
    // Gesundheitschecks zaehlen nie mit: weder Railways eigene Probes noch
    // der Start des Playwright-Webservers (der auf `/api/v1/health` wartet)
    // duerfen an einer ausgeschoepften Grenze scheitern. Pfadbasiert, weil
    // der generierte Zaehler-Schluessel (`keyGenerator`) die Stufe
    // enthaelt, nicht den nackten Pfad.
    allowList: (request: FastifyRequest): boolean => pathOf(request) === HEALTH_PATH,
    max: (request: FastifyRequest): number =>
      maxFor(resolveRateLimitTier(pathOf(request)), environment),
    keyGenerator: (request: FastifyRequest): string =>
      `${resolveRateLimitTier(pathOf(request))}:${request.ip}`,
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
