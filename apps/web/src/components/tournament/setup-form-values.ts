import type { InRule, OutRule, SeedingMode, TournamentFormat } from "@darts-platform/schemas";
import type { MatchMode } from "@darts-platform/domain";

/**
 * React Hook Form owns the form state (AGENTS.md §18). The values stay in the
 * shapes an input element produces; the Zod contract does the coercion on submit.
 * No `readonly` here: react-hook-form's mapped types need mutable fields.
 * Eigene Datei, damit `setup-sheet.tsx` und die Vereinsduell-Module den Typ
 * ohne Importzyklus teilen.
 */
export interface SetupFormValues {
  name: string;
  startsAt: string;
  format: TournamentFormat;
  startingScore: string;
  inRule: InRule;
  outRule: OutRule;
  /** Reine Eingabehilfe: im Matchplay-Modus geht `bestOfSets: 1` an den Server. */
  mode: MatchMode;
  bestOfLegs: string;
  bestOfSets: string;
  participantIds: string[];
  groupCount: string;
  qualifyPerGroup: string;
  knockoutSize: string;
  seeding: SeedingMode;
  boardIds: string[];
  /** Vereinsduell (CLUB_DUEL): Namen beider Seiten. */
  sideAName: string;
  sideBName: string;
  qualifyingRounds: string;
  finalRoundSize: string;
  thirdPlaceMatch: boolean;
  /** Vereinsduell: Spieler-IDs je Seite; eine ID steht nie auf beiden Seiten. */
  sideAIds: string[];
  sideBIds: string[];
}
