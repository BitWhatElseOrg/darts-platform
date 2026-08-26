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

import { getAuditContext } from "./audit-context.js";

@Injectable()
export class ApiLoggingInterceptor implements NestInterceptor {
  public constructor(@Inject(Logger) private readonly logger: Logger) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const startedAt = performance.now();
    const correlationId = getAuditContext(request).correlationId;

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
    this.logger.log(
      {
        event: "http_request_completed",
        method: input.request.method,
        path: input.request.url.split("?", 1)[0],
        statusCode: input.statusCode,
        durationMs: Math.round((performance.now() - input.startedAt) * 100) / 100,
        correlationId: input.correlationId,
      },
      ApiLoggingInterceptor.name,
    );
  }
}
