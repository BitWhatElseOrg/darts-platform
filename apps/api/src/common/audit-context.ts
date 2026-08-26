import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const contexts = new WeakMap<FastifyRequest, AuditContext>();

export interface AuditContext {
  readonly correlationId: string;
  readonly ip: string;
  readonly userAgent: string | null;
}

export function getAuditContext(request: FastifyRequest): AuditContext {
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
    ip: request.ip,
    userAgent: typeof userAgent === "string" ? userAgent : null,
  };

  contexts.set(request, context);
  return context;
}
