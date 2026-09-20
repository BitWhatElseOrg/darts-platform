import type { EmailLogger, EmailMessage, EmailSender, EmailSendResult } from "./email-message.js";

/**
 * Provider `log`: nichts verlaesst den Prozess. Empfaenger, Betreff und
 * Textvariante landen im strukturierten Log, damit Entwicklung und E2E den
 * Link nachlesen koennen. In Produktion nie aktiv.
 */
export class LoggingEmailSender implements EmailSender {
  public constructor(private readonly logger: EmailLogger) {}

  public async send(message: EmailMessage, idempotencyKey: string): Promise<EmailSendResult> {
    this.logger.emit("log", {
      event: "email.logged",
      to: message.to,
      subject: message.subject,
      text: message.text,
      idempotencyKey,
    });
    return { kind: "sent", providerMessageId: `log:${idempotencyKey}` };
  }
}
