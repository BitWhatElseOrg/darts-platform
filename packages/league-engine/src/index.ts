/**
 * Die League-Engine bildet den Ligabetrieb als reine Domänenlogik ab:
 * Begegnungsvorlage, Aufstellung, Wertung und Tabelle. Verbindliche fachliche
 * Grundlage ist das VFC-Liga-Reglement im Repository-Root
 * (`LIGA-REGLEMENT.md`); Regelverweise im Code nennen die jeweilige Ziffer,
 * zum Beispiel `Reglement 2.2.8` für die Reihenfolge der Spiele.
 */

export { LeagueValidationError } from "./errors.js";
export {
  validateEncounterTemplate,
  type Discipline,
  type InRule,
  type OutRule,
  type Side,
  type SlotRole,
  type TemplateSlot,
} from "./template.js";
export {
  buildEncounterTemplate,
  vfcTemplateOptions,
  type StartingScore,
  type TemplateOptions,
} from "./encounter-template.js";
export {
  resolveSlotOccupancy,
  validateDoublesPairings,
  validateNominations,
  validateSubstitution,
  type DoublesInput,
  type DoublesPairing,
  type LineupRules,
  type NominationEntry,
  type NominationInput,
  type NominationOrigin,
  type OccupancyInput,
  type OccupancySlot,
  type SideLineup,
  type SideOccupancy,
  type SlotOccupancy,
  type SubstitutionInput,
  type SubstitutionRecord,
} from "./lineup.js";
export {
  calculateEncounterResult,
  resolveDeciderRequirement,
  type DeciderDecision,
  type EncounterResult,
  type ResultInput,
  type ResultSlot,
  type ScoringRules,
  type SlotOutcome,
} from "./result.js";
export {
  calculateStandings,
  type StandingsEncounter,
  type StandingsEncounterStatus,
  type StandingsInput,
  type StandingsRow,
} from "./standings.js";
export {
  calculatePlayerRanking,
  type PlayerRankingInput,
  type PlayerRankingRow,
  type PlayerRankingSlot,
} from "./player-ranking.js";
