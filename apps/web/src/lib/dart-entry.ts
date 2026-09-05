import { previewVisitOutcome, type Dart, type InRule, type OutRule } from "@darts-platform/scoring-engine";

/**
 * Zustand der Wurf-fuer-Wurf-Eingabe einer laufenden Aufnahme (bis zu drei
 * Wuerfe). Reine Vorschau fuer die Person am Board: ueber Bust und Checkout
 * entscheidet verbindlich die Engine auf dem Server.
 */
export interface DartEntryState {
  readonly darts: readonly Dart[];
  readonly modifier: 1 | 2 | 3;
}

/**
 * Regelkontext einer Aufnahme: Reststand und Regeln VOR dem gerade
 * erfassten Wurf. Bleibt fuer alle Wuerfe derselben Aufnahme gleich – erst
 * die naechste Aufnahme traegt einen neuen Reststand. Der Reducer braucht
 * ihn, um nach einem bereits erreichten Checkout keinen weiteren Wurf mehr
 * anzunehmen (Auflage aus Task 3): ohne Reststand und Regeln koennte er
 * einen Checkout gar nicht erkennen.
 */
export interface VisitContext {
  readonly remaining: number;
  readonly startingScore: number;
  readonly inRule: InRule;
  readonly outRule: OutRule;
}

export type DartEntryAction =
  | ({ readonly type: "SEGMENT"; readonly segment: number } & VisitContext)
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
      // Auflage aus Task 3: Ist die Aufnahme schon durch einen Checkout
      // abgeschlossen (auch vor dem dritten Wurf), nimmt sie keinen weiteren
      // Wurf mehr an – sonst macht ein nachtraeglicher Fehlwurf aus dem Sieg
      // einen Bust, weil in der Engine der letzte Wurf entscheidet.
      const alreadyComplete = previewVisitOutcome({
        darts: state.darts,
        remaining: action.remaining,
        rules: { startingScore: action.startingScore, inRule: action.inRule, outRule: action.outRule },
      }).complete;
      if (alreadyComplete) return state;
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

/**
 * Nur Vorschau, reicht direkt an `previewVisitOutcome` aus der Scoring
 * Engine weiter: die Regel-Logik (Double-In-Zaehlung, Checkout-, Bust- und
 * Master-Out-Erkennung) lebt an genau einer Stelle, nicht doppelt in
 * `apps/web` und im Server. Ueber Bust und Checkout entscheidet verbindlich
 * die Engine auf dem Server; weicht ihre Antwort ab, gilt die Antwort.
 */
export function previewDartEntry(input: VisitContext & { readonly darts: readonly Dart[] }): DartEntryPreview {
  return previewVisitOutcome({
    darts: input.darts,
    remaining: input.remaining,
    rules: { startingScore: input.startingScore, inRule: input.inRule, outRule: input.outRule },
  });
}
