export const applicationLogLevels = [
  "fatal",
  "error",
  "warn",
  "log",
  "debug",
  "verbose",
] as const;

export type ApplicationLogLevel = (typeof applicationLogLevels)[number];
export type LogDestination = "stdout" | "stderr";
export type LogWriter = (destination: LogDestination, record: string) => void;
export type LogFields = Readonly<Record<string, unknown>>;

const severity: Readonly<Record<ApplicationLogLevel, number>> = {
  verbose: 10,
  debug: 20,
  log: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface StructuredLogEmitter {
  emit(level: ApplicationLogLevel, fields: LogFields): void;
}

export function defaultLogWriter(destination: LogDestination, record: string): void {
  const output = destination === "stderr" ? process.stderr : process.stdout;
  output.write(`${record}\n`);
}

/**
 * Erzeugt den Record-Aufbau, den alle Prozesse teilen: ein JSON-Objekt je
 * Zeile mit Zeitstempel, Level und Dienstname. Der Kern kennt weder NestJS
 * noch eine Datenbank, damit ihn auch der Worker verwenden kann.
 */
export function createStructuredLogEmitter(
  service: string,
  minimumLevel: ApplicationLogLevel,
  writer: LogWriter = defaultLogWriter,
): StructuredLogEmitter {
  return {
    emit(level, fields) {
      if (severity[level] < severity[minimumLevel]) return;

      const record = JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service,
        ...fields,
      });

      writer(level === "fatal" || level === "error" ? "stderr" : "stdout", record);
    },
  };
}
