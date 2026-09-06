import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

import { STATISTICS_OUTBOX_EVENT_TYPE, outboxEvents } from "@darts-platform/database";
import type { OutboxHealth } from "@darts-platform/schemas";

import { DatabaseService } from "../database/database.service.js";

/**
 * Misst den Rückstand beider Outbox-Konsumenten. Die Abfragen laufen ohne
 * Organisationsfilter: ein Betriebssignal über den gesamten Prozess, keine
 * Benutzeranfrage — herausgegeben werden nur Zahlen, keine Organisationsdaten.
 *
 * Das Alter wird in der Datenbank gerechnet (`now()`), damit eine Abweichung
 * der Anwendungsuhr das Signal nicht verfälscht. Dead-Letter-Zeilen zählen
 * nicht als Rückstand — sie warten auf eine Entscheidung, nicht auf den
 * Poller. Der Statistik-Rückstand filtert zusätzlich auf
 * `MATCH_COMPLETED`, weil `statistics_processed_at` für jeden anderen
 * Ereignistyp planmässig für immer leer bleibt.
 *
 * Bewusst NICHT über `outboxPending` aus `@darts-platform/database`: dessen
 * Backoff-Bedingung (`not_before`) blendet Zeilen aus, die gerade auf ihren
 * nächsten Versuch warten. Für den Poller ist das richtig, für den Rückstand
 * nicht — eine wartende Zeile ist Rückstand.
 *
 * Die Prädikate decken sich mit den partiellen Indexen aus `schema.ts`:
 * `outbox_events_pending_publication_idx` (`published_at is null`),
 * `outbox_events_pending_statistics_idx` (`statistics_processed_at is null
 * and event_type = 'MATCH_COMPLETED'`) und `outbox_events_dead_lettered_idx`
 * für die Zählung — geprüft mit `explain`, alle drei Abfragen scannen genau
 * diesen Index. Sortiert wird danach über `occurred_at`, also über den
 * Rückstand selbst und nie über die ganze Tabelle; die Indexe ordnen nach
 * `sequence`, was der Poll-Reihenfolge entspricht, für das Alter aber nicht
 * dasselbe ist (`occurred_at` ist die Transaktions-Startzeit).
 */
@Injectable()
export class OutboxHealthService {
  public constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
  ) {}

  public async read(): Promise<OutboxHealth> {
    const database = this.databaseService.database;
    const lagSeconds = sql<string>`extract(epoch from (now() - ${outboxEvents.occurredAt}))`;

    const [publishOldest] = await database
      .select({ lagSeconds })
      .from(outboxEvents)
      .where(
        and(
          isNull(outboxEvents.publishedAt),
          isNull(outboxEvents.publishDeadLetteredAt),
        ),
      )
      .orderBy(asc(outboxEvents.occurredAt))
      .limit(1);

    const [statisticsOldest] = await database
      .select({ lagSeconds })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, STATISTICS_OUTBOX_EVENT_TYPE),
          isNull(outboxEvents.statisticsProcessedAt),
          isNull(outboxEvents.statisticsDeadLetteredAt),
        ),
      )
      .orderBy(asc(outboxEvents.occurredAt))
      .limit(1);

    const [deadLettered] = await database
      .select({ total: sql<string>`count(*)` })
      .from(outboxEvents)
      .where(
        or(
          isNotNull(outboxEvents.publishDeadLetteredAt),
          isNotNull(outboxEvents.statisticsDeadLetteredAt),
        ),
      );

    return {
      publishLagSeconds: toSeconds(publishOldest?.lagSeconds),
      statisticsLagSeconds: toSeconds(statisticsOldest?.lagSeconds),
      deadLettered: Number(deadLettered?.total ?? "0"),
    };
  }
}

function toSeconds(value: string | undefined): number | null {
  if (value === undefined) return null;
  return Math.max(0, Math.round(Number(value)));
}
