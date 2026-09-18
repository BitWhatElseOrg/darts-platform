import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";

import { resolveClientAddress } from "./client-address.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const contexts = new WeakMap<FastifyRequest, AuditContext>();

export interface AuditContext {
  readonly correlationId: string;
  readonly ip: string;
  readonly userAgent: string | null;
}

/**
 * `trustProxyHops` bestimmt ueber `resolveClientAddress`, ob `ip` aus
 * `X-Real-IP` oder aus `request.ip` stammt (Plan
 * 2026-09-17-go-live-testprogramm, Task 3, Befund D3-1). Der Wert wird pro
 * Anfrage im ersten Aufruf zwischengespeichert (`contexts`) — jeder weitere
 * Aufruf mit demselben `request` liefert denselben `ip`-Wert, unabhaengig
 * vom hier uebergebenen `trustProxyHops`. Aufrufer erhalten den Wert deshalb
 * explizit aus `APPLICATION_ENVIRONMENT.TRUST_PROXY_HOPS`, statt sich auf die
 * Aufrufreihenfolge zu verlassen.
 */
export function getAuditContext(
  request: FastifyRequest,
  trustProxyHops: number,
): AuditContext {
  const existingContext = contexts.get(request);
  if (existingContext !== undefined) {
    return existingContext;
  }

  const requestedCorrelationId = request.headers["x-correlation-id"];
  const correlationId =
    typeof requestedCorrelationId === "string" &&
    uuidPattern.test(requestedCorrelationId)
      ? requestedCorrelationId
      : randomUUID();
  const userAgent = request.headers["user-agent"];

  const context = {
    correlationId,
    ip: resolveClientAddress(request, trustProxyHops),
    userAgent: typeof userAgent === "string" ? userAgent : null,
  };

  contexts.set(request, context);
  return context;
}
