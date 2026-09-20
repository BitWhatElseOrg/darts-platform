import type { EmailLogger, EmailMessage, EmailSender, EmailSendResult } from "./email-message.js";

/** Optionen des Log-Adapters. */
export interface LoggingEmailSenderOptions {
  /**
   * Laesst Empfaenger und Textvariante aus der Log-Zeile weg. In Production
   * gesetzt: dort traegt die Textvariante den Klartext-Einladungscode
   * beziehungsweise den Reset-Link, und das Log ist kein Ort dafuer.
   */
  readonly redactBody?: boolean;
}

/**
 * Provider `log`: nichts verlaesst den Prozess. Empfaenger, Betreff und
 * Textvariante landen im strukturierten Log, damit Entwicklung und E2E den
 * Link nachlesen koennen. Fuer Entwicklung, CI und E2E sowie den ersten
 * Rollout-Schritt (`infrastructure/railway.md`); im Regelbetrieb in
 * Produktion nicht aktiv — und laeuft Production doch auf `log`, bleiben
 * Empfaenger und Text mit `redactBody` aus dem Log.
 */
export class LoggingEmailSender implements EmailSender {
  private readonly redactBody: boolean;

  public constructor(
    private readonly logger: EmailLogger,
    options: LoggingEmailSenderOptions = {},
  ) {
    this.redactBody = options.redactBody ?? false;
  }

  public async send(message: EmailMessage, idempotencyKey: string): Promise<EmailSendResult> {
    this.logger.emit(
      "log",
      this.redactBody
        ? {
            event: "email.logged",
            subject: message.subject,
            idempotencyKey,
            redacted: true,
          }
        : {
            event: "email.logged",
            to: message.to,
            subject: message.subject,
            text: message.text,
            idempotencyKey,
          },
    );
    return { kind: "sent", providerMessageId: `log:${idempotencyKey}` };
  }
}
