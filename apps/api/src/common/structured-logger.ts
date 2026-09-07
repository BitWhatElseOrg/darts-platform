import type { LoggerService } from "@nestjs/common";
import {
  createStructuredLogEmitter,
  type ApplicationLogLevel,
  type LogDestination,
  type LogFields,
  type LogWriter,
  type StructuredLogEmitter,
} from "@darts-platform/config";

export type { ApplicationLogLevel, LogDestination, LogWriter };

function serializeMessage(message: unknown): LogFields {
  if (message instanceof Error) {
    return {
      message: message.message,
      errorName: message.name,
      stack: message.stack,
    };
  }

  if (typeof message === "object" && message !== null) {
    return message as LogFields;
  }

  return { message: String(message) };
}

function contextFrom(optionalParameters: readonly unknown[]): string | undefined {
  const candidate = optionalParameters.at(-1);
  return typeof candidate === "string" ? candidate : undefined;
}

/**
 * NestJS-Adapter auf den gemeinsamen Record-Aufbau aus `packages/config`.
 * Der Worker nutzt denselben Kern ohne NestJS.
 */
export class StructuredLogger implements LoggerService {
  private readonly emitter: StructuredLogEmitter;

  public constructor(
    service: string,
    minimumLevel: ApplicationLogLevel,
    writer?: LogWriter,
  ) {
    this.emitter = createStructuredLogEmitter(service, minimumLevel, writer);
  }

  public log(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write("log", message, optionalParameters);
  }

  public fatal(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write("fatal", message, optionalParameters);
  }

  public error(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write("error", message, optionalParameters);
  }

  public warn(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write("warn", message, optionalParameters);
  }

  public debug(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write("debug", message, optionalParameters);
  }

  public verbose(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write("verbose", message, optionalParameters);
  }

  private write(
    level: ApplicationLogLevel,
    message: unknown,
    optionalParameters: readonly unknown[],
  ): void {
    const context = contextFrom(optionalParameters);
    this.emitter.emit(level, {
      ...serializeMessage(message),
      ...(context === undefined ? {} : { context }),
    });
  }
}
