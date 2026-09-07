import { and, asc, inArray, isNotNull, lt, ne, or } from "drizzle-orm";

import { outboxEvents, type Database } from "@darts-platform/database";

/**
 * Wie lange eine vollstaendig verarbeitete Outbox-Zeile stehen bleibt. Sie ist
 * danach weder fuer die Verteilung noch fuer die Statistik von Belang; die
 * fachliche Spur liegt in `audit_events` und im jeweiligen Kommandostrom.
 */
export const OUTBOX_RETENTION_DAYS = 30;

/**
 * Obergrenze pro Lauf. Ohne sie loescht ein grosser Rueckstand in einer
 * einzigen, lang laufenden Transaktion gegen `outbox_events` — genau die
 * Tabelle, gegen die beide Poller im Sekundentakt lesen. Ein Rueckstand
 * baut sich so ueber mehrere stuendliche Laeufe ab statt einen davon zu
 * blockieren.
 */
export const OUTBOX_PRUNE_BATCH_SIZE = 1000;

/**
 * Ohne Aufraeumregel waechst `outbox_events` unbegrenzt: beide Poller laufen
 * im Sekundentakt gegen eine Tabelle, die nur zunimmt (Befund I7). Entfernt
 * werden ausschliesslich Zeilen, die
 *
 * - verteilt sind (`published_at is not null`) UND
 * - statistisch erledigt sind oder die Statistik nie betrafen UND
 * - aelter als die Aufbewahrungsfrist sind.
 *
 * Eine Zeile, die einer der drei Bedingungen nicht genuegt, bleibt stehen —
 * die Aufraeumregel darf nie ein unverarbeitetes Ereignis verschlucken.
 *
 * Geloescht wird ueber eine Unterabfrage, die die Treffermenge auf
 * `OUTBOX_PRUNE_BATCH_SIZE` begrenzt (M4): ohne diese Grenze waere ein
 * einzelner Lauf bei einem grossen Rueckstand ein unbegrenzt langes DELETE.
 * Zurueckgegeben wird die tatsaechlich betroffene Zeilenzahl aus dem
 * Treiberergebnis (`count`), nicht ueber `.returning(...)` — die Zeilen
 * selbst werden hier nicht gebraucht.
 */
export async function pruneProcessedOutboxEvents(
  database: Database,
  now: Date,
  retentionDays: number = OUTBOX_RETENTION_DAYS,
  batchSize: number = OUTBOX_PRUNE_BATCH_SIZE,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const predicate = and(
    isNotNull(outboxEvents.publishedAt),
    or(
      isNotNull(outboxEvents.statisticsProcessedAt),
      ne(outboxEvents.eventType, "MATCH_COMPLETED"),
    ),
    lt(outboxEvents.occurredAt, cutoff),
  );
  const batch = database
    .select({ id: outboxEvents.id })
    .from(outboxEvents)
    .where(predicate)
    .orderBy(asc(outboxEvents.sequence))
    .limit(batchSize);
  const result = await database.delete(outboxEvents).where(inArray(outboxEvents.id, batch));
  return result.count;
}
