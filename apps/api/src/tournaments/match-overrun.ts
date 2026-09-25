/**
 * Ob ein laufendes Turniermatch ueberzieht (Board-Slot `overrunning`).
 *
 * Reine Funktion ohne Infrastruktur. Die Erwartung ist bewusst grob und
 * vereinsnah: ein 501-Leg dauert rund sieben Minuten, ein Match so viele
 * Legs mal Saetze; ueberzogen ist, was anderthalb Mal so lange laeuft.
 * Die Kommandozentrale faerbt daran nur die Laufzeit rot -- sie sperrt
 * nichts, deshalb reicht eine Faustregel (Probelauf 25.09.2026, Befund 4).
 */
const MINUTES_PER_LEG = 7;
const TOLERANCE = 1.5;

export function expectedMatchMinutes(input: {
  readonly bestOfLegs: number;
  readonly bestOfSets: number;
}): number {
  return input.bestOfLegs * input.bestOfSets * MINUTES_PER_LEG;
}

export function isMatchOverrunning(input: {
  readonly startedAt: Date;
  readonly now: Date;
  readonly bestOfLegs: number;
  readonly bestOfSets: number;
}): boolean {
  const elapsedMinutes = (input.now.getTime() - input.startedAt.getTime()) / 60_000;
  return elapsedMinutes > expectedMatchMinutes(input) * TOLERANCE;
}
