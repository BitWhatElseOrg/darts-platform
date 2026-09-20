import { and, asc, inArray, isNotNull, lt, or } from "drizzle-orm";

import { emailDeliveries, type Database } from "@darts-platform/database";

/**
 * Wie lange ein erledigter Versandauftrag stehen bleibt. Danach ist er weder
 * fuer den Poller noch fuer den Zustellstatus einer Einladung von Belang;
 * der Payload ist bei einer erledigten Zeile ohnehin schon geleert.
 */
export const EMAIL_DELIVERY_RETENTION_DAYS = 30;

/**
 * Obergrenze pro Lauf. Ohne sie loescht ein grosser Rueckstand in einer
 * einzigen, lang laufenden Transaktion gegen `email_deliveries` — genau die
 * Tabelle, gegen die der Poller im Sekundentakt liest.
 */
export const EMAIL_DELIVERY_PRUNE_BATCH_SIZE = 1000;

/**
 * Entfernt versendete und dead-geletterte Auftraege nach der
 * Aufbewahrungsfrist, in Stapeln, damit ein grosser Rueckstand nicht in
 * einem einzigen langen DELETE gegen die Tabelle des Pollers laeuft.
 * Offene Zeilen bleiben immer stehen — die Aufraeumregel darf nie einen
 * unversendeten Auftrag verschlucken.
 *
 * Gemessen wird am Zeitpunkt der Erledigung (`sent_at` beziehungsweise
 * `dead_lettered_at`), nicht an `created_at`: eine Zeile, die lange im
 * Backoff lag, soll ihre Frist ab ihrem Abschluss haben.
 */
export async function pruneEmailDeliveries(
  database: Database,
  now: Date,
  retentionDays: number = EMAIL_DELIVERY_RETENTION_DAYS,
  batchSize: number = EMAIL_DELIVERY_PRUNE_BATCH_SIZE,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const batch = database
    .select({ id: emailDeliveries.id })
    .from(emailDeliveries)
    .where(
      or(
        and(isNotNull(emailDeliveries.sentAt), lt(emailDeliveries.sentAt, cutoff)),
        and(isNotNull(emailDeliveries.deadLetteredAt), lt(emailDeliveries.deadLetteredAt, cutoff)),
      ),
    )
    .orderBy(asc(emailDeliveries.createdAt))
    .limit(batchSize);
  const result = await database.delete(emailDeliveries).where(inArray(emailDeliveries.id, batch));
  return result.count;
}
