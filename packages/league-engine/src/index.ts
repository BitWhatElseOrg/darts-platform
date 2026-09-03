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
