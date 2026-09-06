import { and, eq } from "drizzle-orm";

import { encounterSlots, encounters, type Database } from "@darts-platform/database";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Die globale Sperrreihenfolge fuer alles, was Begegnung und Scoring zugleich
 * beruehrt, lautet: Encounter -> EncounterSlot -> Match.
 *
 * Der Begegnungspfad (`encounters.repository.ts`, `runMutation`) nimmt sie seit
 * je in genau dieser Folge. Der Scoringpfad sperrte bis hierher zuerst die
 * Matchzeile und die Begegnung erst beim Slotabschluss
 * (`sync-encounter-slot.ts`, `update-encounter-progress.ts`) — gegenlaeufig.
 * Der siegbringende Visit auf Slot S (haelt `matches`, will `encounters`) und
 * ein gleichzeitiges `releaseSlot(S)` (haelt `encounters`, will
 * `encounter_slots`) liefen damit in einen Zyklus, den Postgres mit 40P01
 * aufloest. Diese Funktion zieht die beiden Begegnungszeilen im Scoringpfad
 * vor; danach nehmen beide Wege dieselbe Reihenfolge.
 *
 * Der Turnierzweig kollidiert damit nicht: der Scoringpfad sperrt Turnier- vor
 * Begegnungs- vor Slot- vor Matchzeile, in genau dieser festen Reihenfolge
 * (siehe `matches.repository.ts`: `lockTournamentScoringContext` vor
 * `lockEncounterScoringContext` vor der Matchsperre). Selbst ein Match, das
 * zufaellig in beiden Welten verlinkt waere, koennte darin keinen Zyklus
 * bilden — die Uniqueness von `tournament_matches.scoring_match_id` und
 * `encounter_slots.match_id` je fuer sich allein wuerde das nicht verhindern.
 */
export async function lockEncounterScoringContext(
  transaction: DatabaseTransaction,
  organizationId: string,
  scoringMatchId: string,
): Promise<void> {
  const [candidate] = await transaction
    .select({ encounterId: encounterSlots.encounterId })
    .from(encounterSlots)
    .where(
      and(
        eq(encounterSlots.organizationId, organizationId),
        eq(encounterSlots.matchId, scoringMatchId),
      ),
    )
    .limit(1);
  if (candidate === undefined) return;

  await transaction
    .select({ id: encounters.id })
    .from(encounters)
    .where(and(eq(encounters.organizationId, organizationId), eq(encounters.id, candidate.encounterId)))
    .for("update")
    .limit(1);

  // Der Slotbezug kann zwischen der ungesperrten Suche und dieser Sperre
  // weggefallen sein (Ruecknahme der Board-Zuweisung). Dann ist nichts mehr zu
  // sperren, und der weitere Verlauf faellt ueber den Slotzustand durch.
  await transaction
    .select({ id: encounterSlots.id })
    .from(encounterSlots)
    .where(
      and(
        eq(encounterSlots.organizationId, organizationId),
        eq(encounterSlots.matchId, scoringMatchId),
      ),
    )
    .for("update")
    .limit(1);
}
