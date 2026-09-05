import { dartValue, type Dart } from "@darts-platform/scoring-engine";

/**
 * Zustand der Wurf-fuer-Wurf-Eingabe einer laufenden Aufnahme (bis zu drei
 * Wuerfe). Reine Vorschau fuer die Person am Board: ueber Bust und Checkout
 * entscheidet verbindlich die Engine auf dem Server, dieser Reducer kennt
 * weder Reststand noch Ausgangsregel und kann daher selbst keinen Checkout
 * erkennen.
 */
export interface DartEntryState {
  readonly darts: readonly Dart[];
  readonly modifier: 1 | 2 | 3;
}

export type DartEntryAction =
  | { readonly type: "SEGMENT"; readonly segment: number }
  | { readonly type: "MODIFIER"; readonly multiplier: 2 | 3 }
  | { readonly type: "BACKSPACE" }
  | { readonly type: "RESET" };

export const emptyDartEntry: DartEntryState = { darts: [], modifier: 1 };

/**
 * Bull traegt kein Triple, der Fehlwurf gar keinen Multiplikator, und die
 * Bullseye-Taste (Segment 50) ist selbst schon ein Doppel und traegt daher
 * ebenfalls keinen zusaetzlichen Umschalter.
 */
export function isSegmentAvailable(segment: number, modifier: 1 | 2 | 3): boolean {
  if (segment === 0) return modifier === 1;
  if (segment === 50) return modifier === 1;
  if (segment === 25) return modifier <= 2;
  return true;
}

export function dartEntryReducer(state: DartEntryState, action: DartEntryAction): DartEntryState {
  switch (action.type) {
    case "SEGMENT": {
      if (state.darts.length >= 3) return state;
      if (!isSegmentAvailable(action.segment, state.modifier)) return state;
      // Die Bullseye-Taste traegt den Wert, nicht das Segment: 50 ist Doppel 25.
      if (action.segment === 50) {
        return { darts: [...state.darts, { segment: 25, multiplier: 2 }], modifier: 1 };
      }
      const multiplier = action.segment === 0 ? 1 : state.modifier;
      return { darts: [...state.darts, { segment: action.segment, multiplier }], modifier: 1 };
    }
    case "MODIFIER":
      return { ...state, modifier: state.modifier === action.multiplier ? 1 : action.multiplier };
    case "BACKSPACE":
      return { darts: state.darts.slice(0, -1), modifier: 1 };
    case "RESET":
      return emptyDartEntry;
  }
}

export interface DartEntryPreview {
  readonly points: number;
  readonly remaining: number;
  readonly complete: boolean;
  readonly outcome: "OPEN" | "SCORED" | "BUST" | "CHECKOUT";
}

function closes(outRule: "SINGLE" | "DOUBLE" | "MASTER", finishing: Dart): boolean {
  switch (outRule) {
    case "SINGLE":
      return true;
    case "DOUBLE":
      return finishing.multiplier === 2;
    case "MASTER":
      return finishing.multiplier >= 2;
  }
}

/**
 * Nur Vorschau. Ueber Bust und Checkout entscheidet die Engine auf dem
 * Server; weicht ihre Antwort ab, gilt die Antwort.
 *
 * Ein Checkout schliesst die Aufnahme unabhaengig von der Anzahl bereits
 * erfasster Wuerfe ab (`complete: true` schon nach dem ersten oder zweiten
 * Wurf) – die aufrufende Komponente darf nach einem Checkout keine weiteren
 * Wuerfe mehr an den Reducer weitergeben, sonst macht ein nachfolgender
 * Fehlwurf aus dem Sieg einen Bust, weil in der Engine der letzte Wurf
 * entscheidet.
 */
export function previewDartEntry(input: {
  readonly darts: readonly Dart[];
  readonly remaining: number;
  readonly outRule: "SINGLE" | "DOUBLE" | "MASTER";
}): DartEntryPreview {
  const points = input.darts.reduce((sum, dart) => sum + dartValue(dart), 0);
  const tentative = input.remaining - points;
  const finishing = input.darts.at(-1) ?? null;
  const checkout = tentative === 0 && finishing !== null && closes(input.outRule, finishing);
  const bust =
    tentative < 0 || (input.outRule !== "SINGLE" && tentative === 1) || (tentative === 0 && !checkout);
  if (checkout) return { points, remaining: 0, complete: true, outcome: "CHECKOUT" };
  if (bust) return { points, remaining: input.remaining, complete: true, outcome: "BUST" };
  return {
    points,
    remaining: tentative,
    complete: input.darts.length >= 3,
    outcome: input.darts.length >= 3 ? "SCORED" : "OPEN",
  };
}
