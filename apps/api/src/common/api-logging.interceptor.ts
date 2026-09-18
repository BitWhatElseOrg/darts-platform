import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Observable } from "rxjs";
import { tap } from "rxjs";

import { RAW_ADDRESS_HEADERS, resolveClientAddress } from "./client-address.js";
import { getAuditContext } from "./audit-context.js";

@Injectable()
export class ApiLoggingInterceptor implements NestInterceptor {
  public constructor(
    @Inject(Logger) private readonly logger: Logger,
    private readonly logClientAddress: boolean,
    // Fuer `getAuditContext`/`resolveClientAddress` (Plan
    // 2026-09-17-go-live-testprogramm, Task 3): kein Default — der Aufrufer
    // muss den echten Wert aus `APPLICATION_ENVIRONMENT.TRUST_PROXY_HOPS`
    // mitgeben (`configure-application.ts`), sonst faellt die zwischen-
    // gespeicherte `AuditContext.ip` still auf `request.ip` zurueck.
    private readonly trustProxyHops: number,
  ) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const startedAt = performance.now();
    const correlationId = getAuditContext(request, this.trustProxyHops).correlationId;

    return next.handle().pipe(
      tap({
        next: () => {
          this.logRequest({
            request,
            statusCode: reply.statusCode,
            correlationId,
            startedAt,
          });
        },
        error: (error: unknown) => {
          this.logRequest({
            request,
            statusCode: error instanceof HttpException ? error.getStatus() : 500,
            correlationId,
            startedAt,
          });
        },
      }),
    );
  }

  private logRequest(input: {
    readonly request: FastifyRequest;
    readonly statusCode: number;
    readonly correlationId: string;
    readonly startedAt: number;
  }): void {
    const headers = input.request.headers;
    this.logger.log(
      {
        event: "http_request_completed",
        method: input.request.method,
        path: input.request.url.split("?", 1)[0],
        statusCode: input.statusCode,
        durationMs: Math.round((performance.now() - input.startedAt) * 100) / 100,
        correlationId: input.correlationId,
        // Diagnose fuer die Nachmessung des Rate-Limit-Schluessels (Plan
        // 2026-09-17-go-live-testprogramm, Task 3, Step 7) gegen Staging und
        // Production: nur mit LOG_CLIENT_ADDRESS=true, weil `ip`,
        // `clientAddress` und die rohen Adress-Header personenbezogen sind.
        // Bleibt bis zur Nachmessung bestehen — erst danach ist belegt, dass
        // Railway `X-Real-IP` auch im Produktions-Setup ueberschreibt.
        ...(this.logClientAddress
          ? {
              ip: input.request.ip,
              clientAddress: resolveClientAddress(input.request, this.trustProxyHops),
              addressHeaders: Object.fromEntries(
                RAW_ADDRESS_HEADERS.map(
                  (name): [string, string | null] => [name, headerValue(headers[name])],
                ),
              ) as Record<(typeof RAW_ADDRESS_HEADERS)[number], string | null>,
            }
          : {}),
      },
      ApiLoggingInterceptor.name,
    );
  }
}

function headerValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  const joined = Array.isArray(value) ? value.join(", ") : value;
  return joined.length > 200 ? `${joined.slice(0, 200)}…` : joined;
}
