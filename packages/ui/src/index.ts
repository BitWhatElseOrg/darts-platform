export { Button, type ButtonProps } from "./components/button";
export { cn } from "./lib/cn";

/**
 * Sektorenring — the tournament surface's primitive set.
 * Its grammar comes from the board itself: sisal ground, black sectors, the
 * steel spider as the only divider, enamel numerals, and the red/green
 * double ring as the state signal. Square corners throughout.
 */
export { Control, type ControlProps } from "./sektorenring/control";
export {
  Field,
  SelectInput,
  TextInput,
  type FieldProps,
  type SelectInputProps,
  type TextInputProps,
} from "./sektorenring/field";
export {
  MarkBar,
  MarkCheck,
  MarkChevron,
  MarkClock,
  MarkCross,
  MarkDisc,
  MarkDoubleRing,
  MarkFlight,
  MarkHatch,
} from "./sektorenring/marks";
export {
  BoardPlate,
  RingSteps,
  type BoardPlateProps,
  type RingStep,
  type RingStepsProps,
} from "./sektorenring/plate";
export { StateTag, type StateTagProps, type StateTone } from "./sektorenring/state-tag";
export { Rule, Wedge, type RuleProps, type WedgeProps } from "./sektorenring/surface";
export { Table, Td, Th, Tr, type TrProps } from "./sektorenring/table";
export {
  Score,
  SheetLabel,
  type ScoreProps,
  type SheetLabelProps,
} from "./sektorenring/typography";
