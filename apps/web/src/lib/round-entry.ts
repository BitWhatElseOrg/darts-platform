import { isAttainableScore, type Dart, type InRule, type OutRule } from "@darts-platform/scoring-engine";

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
 * darstellen und geht deshalb als `checkoutSegment` raus (siehe
 * `checkoutCommandFields`).
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
 * Doppel-Segment 1-20/25 (x01.ts `checkoutValue`); ein Triple traegt deshalb
 * `checkoutSegment` (siehe `checkoutCommandFields`).
 */
export function checkoutDoubleFromField(field: string): number | undefined {
  const selection = decodeCheckoutField(field);
  return selection?.kind === "DOUBLE" ? selection.segment : undefined;
}

/**
 * Das abschliessende Segment fuer `checkoutSegment` — Segment UND
 * Multiplikator, deshalb auch fuer ein Triple tragfaehig. `undefined`, wenn
 * kein Feld gewaehlt ist.
 */
export function checkoutSegmentFromField(field: string): Dart | undefined {
  const selection = decodeCheckoutField(field);
  if (selection === null) return undefined;
  return { segment: selection.segment, multiplier: selection.kind === "TRIPLE" ? 3 : 2 };
}

/**
 * Die Belegfelder, mit denen der Checkout-Schritt die Aufnahme absendet.
 *
 * Unter Master Out geht IMMER `checkoutSegment` raus — Doppel wie Triple. Ein
 * Triple laesst sich ueber `checkoutDouble` gar nicht ausdruecken (x01.ts,
 * `checkoutValue`), und ein Master-Out-Match haette sonst zwei verschiedene
 * Belegwege je nach getroffenem Ring.
 *
 * Unter Double Out bleibt es beim bestehenden `checkoutDouble`: dort kann nur
 * ein Doppel schliessen, das Feld traegt genau das, und die gespeicherte
 * Nutzlast des mit Abstand haeufigsten Falls (Liga: 501 Double In / Double
 * Out) aendert sich dadurch nicht.
 *
 * Ohne gewaehltes Feld bleibt das Ergebnis leer; die Engine wertet die
 * Aufnahme dann nach ihren eigenen Regeln (unter Double Out ein Bust).
 */
export function checkoutCommandFields(field: string, outRule: "DOUBLE" | "MASTER"): {
  readonly checkoutDouble?: number;
  readonly checkoutSegment?: Dart;
} {
  if (outRule === "MASTER") {
    const segment = checkoutSegmentFromField(field);
    return segment === undefined ? {} : { checkoutSegment: segment };
  }
  const checkoutDouble = checkoutDoubleFromField(field);
  return checkoutDouble === undefined ? {} : { checkoutDouble };
}

/**
 * Muss diese Aufnahme Wurf fuer Wurf erfasst werden, auch wenn der
 * Runden-Modus eingestellt ist?
 *
 * Unter Double In zaehlt eine Aufnahme erst ab dem eroeffnenden Doppel. Aus
 * einer blossen Rundensumme laesst sich der Anteil davor nicht
 * rekonstruieren, deshalb lehnt die Engine sie im Schreibpfad ab (x01.ts,
 * `assertWritableVisit`, `DARTS_REQUIRED_FOR_DOUBLE_IN`). Solange die Seite am
 * Oche im laufenden Leg nicht eroeffnet hat, zeigt die Flaeche deshalb das
 * Dart-Keypad; danach kehrt der Runden-Modus zurueck.
 *
 * Die Nullaufnahme waere zwar weiterhin erlaubt (die Engine verlangt Wurfdaten
 * nur bei `points > 0`), sie laesst sich im Dart-Modus aber als drei
 * Fehlwuerfe erfassen — ein Sonderpfad dafuer waere ein zweiter Zustand ohne
 * zusaetzlichen Nutzen.
 */
export function requiresDartEntry(
  match: { readonly inRule: InRule },
  participant: { readonly openedInLeg: boolean } | undefined,
): boolean {
  if (participant === undefined) return false;
  return match.inRule === "DOUBLE" && !participant.openedInLeg;
}
