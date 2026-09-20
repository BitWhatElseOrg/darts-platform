import { and, eq, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import type { DatabaseExecutor } from "./client.js";
import { outboxBackoffMillisSql, type OutboxLogger } from "./outbox.js";
import { emailDeliveries } from "./schema.js";

/**
 * Stapelgroesse des Mail-Pollers. Klein, weil die Zeilensperre waehrend des
 * Provider-Aufrufs haelt (bis 10 s je Zeile): 5 Zeilen begrenzen die
 * Transaktion auf unter einer Minute im schlechtesten Fall.
 */
export const EMAIL_DELIVERY_BATCH_SIZE = 5;

const MAX_ERROR_LENGTH = 500;

export type EmailDeliveryKindValue = "INVITATION" | "PASSWORD_RESET";

export interface EnqueueEmailDeliveryInput {
  readonly kind: EmailDeliveryKindValue;
  readonly recipient: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly organizationId?: string | null;
  readonly invitationId?: string | null;
}

/**
 * Legt einen Versandauftrag an. Aufrufer uebergeben die offene Transaktion
 * der fachlichen Aenderung, damit Einladung und Mailauftrag gemeinsam
 * committen oder gemeinsam scheitern.
 */
export async function enqueueEmailDelivery(
  executor: DatabaseExecutor,
  input: EnqueueEmailDeliveryInput,
): Promise<{ readonly id: string }> {
  const [row] = await executor
    .insert(emailDeliveries)
    .values({
      kind: input.kind,
      recipient: input.recipient,
      payload: input.payload,
      organizationId: input.organizationId ?? null,
      invitationId: input.invitationId ?? null,
    })
    .returning({ id: emailDeliveries.id });
  if (row === undefined) throw new Error("email_deliveries insert did not return a row.");
  return row;
}

/** Offen, nicht dead-gelettet, Backoff abgelaufen. */
export function emailDeliveryPending(now: Date): SQL | undefined {
  return and(
    isNull(emailDeliveries.sentAt),
    isNull(emailDeliveries.deadLetteredAt),
    or(isNull(emailDeliveries.notBefore), lte(emailDeliveries.notBefore, now)),
  );
}

/** Bucht den Erfolg und leert den Payload. `false`: Zeile war schon erledigt. */
export async function markEmailDeliverySent(
  executor: DatabaseExecutor,
  input: { readonly id: string; readonly providerMessageId: string; readonly now: Date },
): Promise<boolean> {
  const rows = await executor
    .update(emailDeliveries)
    .set({
      sentAt: input.now,
      providerMessageId: input.providerMessageId,
      payload: null,
      notBefore: null,
    })
    .where(
      and(
        eq(emailDeliveries.id, input.id),
        isNull(emailDeliveries.sentAt),
        isNull(emailDeliveries.deadLetteredAt),
      ),
    )
    .returning({ id: emailDeliveries.id });
  return rows.length > 0;
}

export type EmailDeliveryFailureResult = "retry" | "dead_letter" | "already_processed";

export interface EmailDeliveryFailureInput {
  readonly executor: DatabaseExecutor;
  readonly id: string;
  readonly reason: string;
  readonly now: Date;
  readonly maxAttempts: number;
  /** `true`: sofort Dead-Letter (Provider hat endgueltig abgelehnt). */
  readonly permanent: boolean;
  readonly logger: OutboxLogger;
}

/**
 * Bucht einen Fehlversuch als eine atomare `UPDATE`-Anweisung, serverseitig
 * aus dem Zeilenzustand gerechnet — dasselbe Muster wie
 * `recordOutboxFailure`. Erreicht die Zeile die Obergrenze oder ist der
 * Fehler endgueltig, wird sie dead-gelettet und der Payload geleert; der
 * Klartext-Link liegt dann nicht mehr in der Datenbank.
 */
export async function recordEmailDeliveryFailure(
  input: EmailDeliveryFailureInput,
): Promise<EmailDeliveryFailureResult> {
  const lastError = input.reason.slice(0, MAX_ERROR_LENGTH);
  const nowIso = input.now.toISOString();
  const deadLetter = input.permanent
    ? sql`true`
    : sql`${emailDeliveries.attempts} + 1 >= ${input.maxAttempts}::integer`;

  const rows = await input.executor
    .update(emailDeliveries)
    .set({
      attempts: sql`${emailDeliveries.attempts} + 1`,
      lastError,
      notBefore: sql`case
        when ${deadLetter} then null
        else ${nowIso}::timestamptz + (${outboxBackoffMillisSql(emailDeliveries.attempts)} * interval '1 millisecond')
      end`,
      deadLetteredAt: sql`case
        when ${deadLetter} then coalesce(${emailDeliveries.deadLetteredAt}, ${nowIso}::timestamptz)
        else ${emailDeliveries.deadLetteredAt}
      end`,
      payload: sql`case when ${deadLetter} then null else ${emailDeliveries.payload} end`,
    })
    .where(
      and(
        eq(emailDeliveries.id, input.id),
        isNull(emailDeliveries.sentAt),
        isNull(emailDeliveries.deadLetteredAt),
      ),
    )
    .returning({
      attempts: emailDeliveries.attempts,
      deadLetteredAt: emailDeliveries.deadLetteredAt,
      kind: emailDeliveries.kind,
    });

  const row = rows[0];
  if (row === undefined) {
    input.logger.emit("log", {
      event: "email.failure_already_processed",
      deliveryId: input.id,
      lastError,
    });
    return "already_processed";
  }

  const deadLettered = row.deadLetteredAt !== null;
  input.logger.emit(deadLettered ? "error" : "warn", {
    event: deadLettered ? "email.dead_letter" : "email.retry_scheduled",
    deliveryId: input.id,
    kind: row.kind,
    attempts: row.attempts,
    lastError,
  });
  return deadLettered ? "dead_letter" : "retry";
}
