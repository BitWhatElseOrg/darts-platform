import { matchModeOf, matchTargets, type MatchFormat } from "@darts-platform/domain";

/**
 * Best-of-Vorgaben sind ungerade, damit kein Unentschieden entstehen kann; der
 * Vertrag (`createMatchSchema`, `createTournamentSchema`) laesst 1 bis 21 zu.
 * Die Maske bietet deshalb genau diese Werte an.
 */
export const bestOfOptions: readonly number[] = Array.from({ length: 11 }, (_, index) => index * 2 + 1);

function legs(count: number): string {
  return `${count} ${count === 1 ? "Leg" : "Legs"}`;
}

/**
 * Ein Satz, der die Vorgabe in ihr Ergebnis uebersetzt — die Zahlen dafuer
 * kommen aus der Domaene (`matchTargets`), damit die Maske die Siegbedingung
 * nicht zweitkodiert.
 */
export function describeMatchFormat(format: MatchFormat): string {
  const targets = matchTargets(format);
  if (matchModeOf(format) === "MATCHPLAY") {
    return `Best of ${legs(format.bestOfLegs)} – wer zuerst ${legs(targets.legsToWin)} gewinnt.`;
  }
  const sets = `${format.bestOfSets} ${format.bestOfSets === 1 ? "Satz" : "Sätze"}`;
  const won = `${targets.setsToWin} ${targets.setsToWin === 1 ? "Satz" : "Sätzen"}`;
  return `Best of ${sets} à Best of ${legs(format.bestOfLegs)} – Satz an ${legs(targets.legsToWin)}, Match an ${won}.`;
}
