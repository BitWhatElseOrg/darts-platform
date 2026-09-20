import { z } from "zod";

import type { EmailMessage, EmailSender, EmailSendResult } from "./email-message.js";

export const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 10_000;

const successSchema = z.object({ id: z.string().min(1) });
const errorSchema = z.object({ name: z.string().optional(), message: z.string().optional() });

export interface ResendEmailSenderOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Versand ueber die Resend-HTTP-API ohne SDK: ein Endpunkt, ein Aufruf. Der
 * `Idempotency-Key` ist die ID der Versandzeile — ein zweiter Versuch nach
 * einem Absturz zwischen Versand und Buchung liefert dieselbe Mail nicht
 * erneut aus (Resend haelt den Schluessel 24 Stunden).
 *
 * Statusabbildung: 2xx `sent`; 429, 409 (nebenlaeufige idempotente
 * Anfrage / gesperrte Ressource) und 5xx `retryable`; jedes andere 4xx
 * `rejected` — eine ungueltige Adresse wird durch Wiederholen nicht besser.
 */
export class ResendEmailSender implements EmailSender {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(private readonly options: ResendEmailSenderOptions) {
    this.fetchImplementation = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async send(message: EmailMessage, idempotencyKey: string): Promise<EmailSendResult> {
    let response: Response;
    try {
      response = await this.fetchImplementation(RESEND_EMAILS_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      return { kind: "retryable", reason: describeError(error) };
    }

    const body: unknown = await response.json().catch(() => null);

    if (response.ok) {
      const parsed = successSchema.safeParse(body);
      if (!parsed.success) {
        return { kind: "retryable", reason: `${response.status} ohne Nachrichten-ID` };
      }
      return { kind: "sent", providerMessageId: parsed.data.id };
    }

    const details = errorSchema.safeParse(body);
    const name = details.success ? details.data.name ?? "unknown_error" : "unknown_error";
    const text = details.success ? details.data.message ?? "" : "";
    const reason = `${response.status} ${name}: ${text}`.trimEnd();

    if (response.status === 429 || response.status === 409 || response.status >= 500) {
      return { kind: "retryable", reason };
    }
    return { kind: "rejected", reason };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
