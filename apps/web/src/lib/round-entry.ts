import { isAttainableScore, type OutRule } from "@darts-platform/scoring-engine";

/**
 * Haengt eine Ziffer an die Rundensumme an. Eine fuehrende Null wird durch
 * die neue Ziffer ersetzt statt vorangestellt, und Werte ueber 180 (das
 * Maximum mit drei Darts) werden nicht angenommen.
 */
export function appendRoundDigit(current: string, digit: number): string {
  const next = current === "0" ? String(digit) : `${current}${digit}`;
  if (next.length > 3) return current;
  return Number(next) > 180 ? current : next;
}

export function removeRoundDigit(current: string): string {
  return current.slice(0, -1);
}

/**
 * Gesperrt wird nur, was mit drei Darts gar nicht zu werfen ist. Eine
 * Ueberwerfung und ein Rest von eins bleiben erlaubt: das sind Busts, also
 * gueltige Ausgaenge, und wer sie nicht erfassen kann, kann nicht zaehlen.
 * Ueber den Ausgang entscheidet die Engine.
 */
export function isRoundEntrySubmittable(value: string): boolean {
  if (value === "") return false;
  const points = Number(value);
  if (!Number.isInteger(points) || points < 0 || points > 180) return false;
  return isAttainableScore(points, 3);
}

/** Bleibt rechnerisch nur ein Doppel, ist die Nachfrage eine Bestätigung. */
export function onlyPossibleDouble(points: number): number | null {
  if (points === 50) return 25;
  return points <= 40 && points % 2 === 0 ? points / 2 : null;
}

export type CheckoutFieldKind = "DOUBLE" | "TRIPLE";

export interface CheckoutFieldSelection {
  readonly kind: CheckoutFieldKind;
  readonly segment: number;
}

const TRIPLE_FIELD_PREFIX = "T";

/**
 * Wertkodierung des Checkout-Feldes im Runden-Keypad: ein Doppel bleibt die
 * reine Segmentzahl (unveraendert seit Task 13 — haelt E2E-Selektoren wie
 * `selectOption("16")` kompatibel), ein Triple traegt das Praefix "T". Die
 * Engine kennt `checkoutDouble` nur als Doppel-Segment 1-20 oder Bull (25,
 * siehe x01.ts `checkoutValue`); ein Triple laesst sich darueber nicht
 * darstellen und wird beim Absenden deshalb weggelassen (siehe
 * `match-scoreboard.tsx`) — die Engine erkennt den Checkout dann ueber ihre
 * eigene Heuristik `finishesOnMasterSegment`.
 */
export function encodeCheckoutField(kind: CheckoutFieldKind, segment: number): string {
  return kind === "TRIPLE" ? `${TRIPLE_FIELD_PREFIX}${segment}` : String(segment);
}

export function decodeCheckoutField(field: string): CheckoutFieldSelection | null {
  if (field === "") return null;
  if (field.startsWith(TRIPLE_FIELD_PREFIX)) {
    const segment = Number(field.slice(TRIPLE_FIELD_PREFIX.length));
    return Number.isInteger(segment) ? { kind: "TRIPLE", segment } : null;
  }
  const segment = Number(field);
  return Number.isInteger(segment) ? { kind: "DOUBLE", segment } : null;
}

export interface CheckoutFieldOption {
  readonly value: string;
  readonly label: string;
}

const doubleFieldOptions: readonly CheckoutFieldOption[] = [
  ...Array.from({ length: 20 }, (_, index) => index + 1).map((segment) => ({
    value: encodeCheckoutField("DOUBLE", segment),
    label: `D${segment}`,
  })),
  { value: encodeCheckoutField("DOUBLE", 25), label: "Bull (Double 25)" },
];

const tripleFieldOptions: readonly CheckoutFieldOption[] = Array.from({ length: 20 }, (_, index) => index + 1).map(
  (segment) => ({ value: encodeCheckoutField("TRIPLE", segment), label: `T${segment}` }),
);

/**
 * Waehlbare Checkout-Segmente je Ausgangsregel. Reglementarisch schliesst
 * Master Out zusaetzlich auf einem Triple (x01.ts, `masterFinishes`); das
 * aeussere Bull (Single 25) schliesst unter keiner Ausgangsregel und taucht
 * deshalb nirgends auf.
 */
export function checkoutFieldOptions(outRule: "DOUBLE" | "MASTER"): {
  readonly doubles: readonly CheckoutFieldOption[];
  readonly triples: readonly CheckoutFieldOption[];
} {
  return { doubles: doubleFieldOptions, triples: outRule === "MASTER" ? tripleFieldOptions : [] };
}

/** Regelabhaengige Beschriftung des Bust-Knopfs im Checkout-Schritt. */
export function checkoutMissLabel(outRule: "DOUBLE" | "MASTER"): string {
  return outRule === "MASTER" ? "Kein Doppel oder Triple getroffen (Bust)" : "Kein Doppel getroffen (Bust)";
}

/**
 * Master Out ist die einzige Ausgangsregel mit Triple-Finish (x01.ts,
 * `masterFinishes`); jede andere -- inklusive SINGLE, unter der der
 * Checkout-Dialog laut `handleRoundSubmit` in `match-scoreboard.tsx` ohnehin
 * nie oeffnet -- verhaelt sich fuers Checkout-Feld wie DOUBLE.
 */
export function checkoutOutRuleFor(outRule: OutRule): "DOUBLE" | "MASTER" {
  return outRule === "MASTER" ? "MASTER" : "DOUBLE";
}

/**
 * Segment fuer `checkoutDouble`, oder `undefined`, wenn das gewaehlte Feld
 * ein Triple (oder leer) ist. Die Engine kennt `checkoutDouble` nur als
 * Doppel-Segment 1-20/25 (x01.ts `checkoutValue`); ein Triple unter Master
 * Out wird deshalb bewusst OHNE dieses Feld gesendet -- die Engine erkennt
 * den Checkout dann ueber ihre eigene Heuristik `finishesOnMasterSegment`.
 */
export function checkoutDoubleFromField(field: string): number | undefined {
  const selection = decodeCheckoutField(field);
  return selection?.kind === "DOUBLE" ? selection.segment : undefined;
}
