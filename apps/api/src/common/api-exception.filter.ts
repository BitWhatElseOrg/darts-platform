import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { getAuditContext } from "./audit-context.js";

const errorCodes: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: "VALIDATION_ERROR",
  [HttpStatus.UNAUTHORIZED]: "AUTHENTICATION_REQUIRED",
  [HttpStatus.FORBIDDEN]: "PERMISSION_DENIED",
  [HttpStatus.NOT_FOUND]: "RESOURCE_NOT_FOUND",
  [HttpStatus.CONFLICT]: "RESOURCE_CONFLICT",
  [HttpStatus.TOO_MANY_REQUESTS]: "RATE_LIMIT_EXCEEDED",
  // Der Profilbild-Upload ist heute die einzige Route mit Binärkörper;
  // deshalb trägt 413 seinen Code. Kommt eine zweite dazu, wird der Code
  // generisch und die Route nennt ihren eigenen.
  [HttpStatus.PAYLOAD_TOO_LARGE]: "AVATAR_TOO_LARGE",
};

function getMessage(exception: HttpException): string {
  const response = exception.getResponse();

  if (typeof response === "string") {
    return response;
  }

  if (typeof response === "object" && response !== null && "message" in response) {
    const message = response.message;
    if (typeof message === "string") {
      return message;
    }
    if (Array.isArray(message)) {
      return message.filter((item): item is string => typeof item === "string").join("; ");
    }
  }

  return exception.message;
}

function getErrorMetadata(exception: HttpException): { readonly code?: string; readonly details?: unknown } {
  const response = exception.getResponse();
  if (typeof response !== "object" || response === null) return {};
  const code = "code" in response && typeof response.code === "string" ? response.code : undefined;
  const details = "details" in response ? response.details : undefined;
  return { ...(code === undefined ? {} : { code }), ...(details === undefined ? {} : { details }) };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const correlationId = getAuditContext(request).correlationId;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const message =
      exception instanceof HttpException
        ? getMessage(exception)
        : "An internal server error occurred.";
    const metadata = exception instanceof HttpException ? getErrorMetadata(exception) : {};

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled API error (${correlationId})`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    reply.header("x-correlation-id", correlationId).status(status).send({
      error: {
        code: metadata.code ?? errorCodes[status] ?? "INTERNAL_ERROR",
        message,
        correlationId,
        ...(metadata.details === undefined ? {} : { details: metadata.details }),
      },
    });
  }
}
