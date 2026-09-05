import { isAttainableScore } from "@darts-platform/scoring-engine";

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
