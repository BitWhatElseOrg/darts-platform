import type { LoggerService } from "@nestjs/common";

export type ApplicationLogLevel =
  | "fatal"
  | "error"
  | "warn"
  | "log"
  | "debug"
  | "verbose";

type LogRecord = Readonly<Record<string, unknown>>;
export type LogDestination = "stdout" | "stderr";
export type LogWriter = (destination: LogDestination, record: string) => void;

const severity: Readonly<Record<ApplicationLogLevel, number>> = {
  verbose: 10,
  debug: 20,
  log: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

function serializeMessage(message: unknown): LogRecord {
  if (message instanceof Error) {
    return {
      message: message.message,
      errorName: message.name,
      stack: message.stack,
    };
  }

  if (typeof message === "object" && message !== null) {
    return message as LogRecord;
  }

  return { message: String(message) };
}

function contextFrom(optionalParameters: readonly unknown[]): string | undefined {
  const candidate = optionalParameters.at(-1);
  return typeof candidate === "string" ? candidate : undefined;
}

export class StructuredLogger implements LoggerService {
  public constructor(
    private readonly service: string,
    private readonly minimumLevel: ApplicationLogLevel,
    private readonly writer: LogWriter = (destination, record) => {
      const output = destination === "stderr" ? process.stderr : process.stdout;
      output.write(`${record}\n`);
    },
  ) {}

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
    if (severity[level] < severity[this.minimumLevel]) {
      return;
    }

    const context = contextFrom(optionalParameters);
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      ...serializeMessage(message),
      ...(context === undefined ? {} : { context }),
    });

    this.writer(level === "fatal" || level === "error" ? "stderr" : "stdout", record);
  }
}
