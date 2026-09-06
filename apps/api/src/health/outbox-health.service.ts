import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

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
 * für die Zählung — mit `explain` geprüft, jede der drei Abfragen scannt den
 * jeweils zugehörigen Index. Das Indexprädikat selbst ist breiter als die
 * Zählung: der Index deckt jede dead-gelettete Zeile ab, die Zählung filtert
 * zusätzlich auf noch unverarbeitete Zeilen (siehe unten) und liest dafür nur
 * einen Teil der vom Index gefundenen Zeilen.
 *
 * Das Alter kommt aus `min(occurred_at)` statt aus `order by … limit 1`:
 * die Aggregation läuft in einem Durchgang über den Rückstand, ohne
 * Sortierknoten, der bei einem grossen Rückstand — also genau in der Lage,
 * die dieser Endpunkt melden soll — teuer würde. Über die Indexspalte
 * `sequence` zu sortieren wäre noch billiger, misst aber das Alter des
 * Kopfes der Warteschlange statt des ältesten Ereignisses; bei
 * rückdatierten `occurred_at` fallen beide Werte auseinander.
 */
@Injectable()
export class OutboxHealthService {
  public constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
  ) {}

  public async read(): Promise<OutboxHealth> {
    const database = this.databaseService.database;
    // `min` über eine leere Menge liefert `null`, daher der nullable Typ.
    const lagSeconds = sql<
      string | null
    >`extract(epoch from (now() - min(${outboxEvents.occurredAt})))`;

    const [publishOldest] = await database
      .select({ lagSeconds })
      .from(outboxEvents)
      .where(
        and(
          isNull(outboxEvents.publishedAt),
          isNull(outboxEvents.publishDeadLetteredAt),
        ),
      );

    const [statisticsOldest] = await database
      .select({ lagSeconds })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, STATISTICS_OUTBOX_EVENT_TYPE),
          isNull(outboxEvents.statisticsProcessedAt),
          isNull(outboxEvents.statisticsDeadLetteredAt),
        ),
      );

    // Zaehlt nur noch unverarbeitete Dead-Letter-Zeilen: eine Zeile, die im
    // einen Konsumenten dead-gelettet und im anderen bereits erledigt ist
    // (z. B. verteilt, aber statistisch dead-gelettet), zaehlt nur solange
    // mit, wie mindestens eine Seite offen ist. Requeue oder Loeschen der
    // Zeile ist der einzige Weg, sie hier verschwinden zu lassen.
    const [deadLettered] = await database
      .select({ total: sql<string>`count(*)` })
      .from(outboxEvents)
      .where(
        or(
          and(
            isNotNull(outboxEvents.publishDeadLetteredAt),
            isNull(outboxEvents.publishedAt),
          ),
          and(
            isNotNull(outboxEvents.statisticsDeadLetteredAt),
            isNull(outboxEvents.statisticsProcessedAt),
          ),
        ),
      );

    return {
      publishLagSeconds: toSeconds(publishOldest?.lagSeconds),
      statisticsLagSeconds: toSeconds(statisticsOldest?.lagSeconds),
      deadLettered: Number(deadLettered?.total ?? "0"),
    };
  }
}

function toSeconds(value: string | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  return Math.max(0, Math.round(Number(value)));
}
