/** Betreff, Text- und HTML-Variante einer Mail — ohne Empfaenger. */
export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** Eine versandfertige Mail. `from` setzt der Adapter aus seiner Konfiguration. */
export interface EmailMessage extends RenderedEmail {
  readonly to: string;
}

/**
 * Ergebnis eines Versandversuchs. `retryable` heisst: spaeter noch einmal
 * (Provider ueberlastet, Netz weg); `rejected` heisst: nie wieder mit
 * diesem Inhalt (ungueltige Adresse, abgelehnter Absender).
 */
export type EmailSendResult =
  | { readonly kind: "sent"; readonly providerMessageId: string }
  | { readonly kind: "retryable"; readonly reason: string }
  | { readonly kind: "rejected"; readonly reason: string };

/** Port fuer den Versand; Adapter: Resend, Log. */
export interface EmailSender {
  send(message: EmailMessage, idempotencyKey: string): Promise<EmailSendResult>;
}

/** Schmale Log-Schnittstelle, damit das Paket ohne `@darts-platform/config` auskommt. */
export interface EmailLogger {
  emit(
    level: "error" | "warn" | "log" | "debug",
    fields: Readonly<Record<string, unknown>>,
  ): void;
}
