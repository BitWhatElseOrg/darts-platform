import { and, isNotNull, lt, ne, or } from "drizzle-orm";

import { outboxEvents, type Database } from "@darts-platform/database";

/**
 * Wie lange eine vollstaendig verarbeitete Outbox-Zeile stehen bleibt. Sie ist
 * danach weder fuer die Verteilung noch fuer die Statistik von Belang; die
 * fachliche Spur liegt in `audit_events` und im jeweiligen Kommandostrom.
 */
export const OUTBOX_RETENTION_DAYS = 30;

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
 */
export async function pruneProcessedOutboxEvents(
  database: Database,
  now: Date,
  retentionDays: number = OUTBOX_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const removed = await database
    .delete(outboxEvents)
    .where(
      and(
        isNotNull(outboxEvents.publishedAt),
        or(
          isNotNull(outboxEvents.statisticsProcessedAt),
          ne(outboxEvents.eventType, "MATCH_COMPLETED"),
        ),
        lt(outboxEvents.occurredAt, cutoff),
      ),
    )
    .returning({ id: outboxEvents.id });
  return removed.length;
}
