import type { EmailLogger, EmailSender } from "./email-message.js";
import { LoggingEmailSender } from "./logging-email-sender.js";
import { ResendEmailSender } from "./resend-email-sender.js";

export interface EmailSenderOptions {
  readonly provider: "resend" | "log";
  readonly apiKey: string | undefined;
  readonly from: string;
}

/** Waehlt den Adapter zur Umgebung. Die Felder entsprechen `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`. */
export function createEmailSender(options: EmailSenderOptions, logger: EmailLogger): EmailSender {
  switch (options.provider) {
    case "log":
      return new LoggingEmailSender(logger);
    case "resend": {
      if (options.apiKey === undefined || options.apiKey.length === 0) {
        throw new Error("EMAIL_PROVIDER=resend verlangt RESEND_API_KEY.");
      }
      return new ResendEmailSender({ apiKey: options.apiKey, from: options.from });
    }
    default: {
      const exhaustive: never = options.provider;
      throw new Error(`Unbekannter Mail-Provider: ${String(exhaustive)}`);
    }
  }
}
