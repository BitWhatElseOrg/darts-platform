/**
 * Ein Match wird entweder im Matchplay- oder im Set-Modus gespielt.
 *
 * - `MATCHPLAY` — es zaehlen nur Legs: bei Best of 21 Legs gewinnt, wer zuerst
 *   elf Legs holt.
 * - `SETS` — Legs gewinnen einen Satz, Saetze das Match: bei Best of 5 Saetzen
 *   à Best of 5 Legs gewinnt ein Satz an drei Legs und das Match an drei
 *   Saetzen.
 *
 * Der Modus ist keine eigene Spalte, sondern liegt in `bestOfSets`: genau ein
 * Satz heisst Matchplay. Eine zweite Quelle fuer dieselbe Aussage koennte der
 * ersten widersprechen.
 */
export const matchModes = ["MATCHPLAY", "SETS"] as const;

export type MatchMode = (typeof matchModes)[number];

export interface MatchFormat {
  readonly bestOfLegs: number;
  readonly bestOfSets: number;
}

export interface MatchTargets {
  /** Legs fuer einen Satz — im Matchplay-Modus fuer das ganze Match. */
  readonly legsToWin: number;
  /** Saetze fuer das Match; im Matchplay-Modus stets 1. */
  readonly setsToWin: number;
}

export function matchModeOf(format: MatchFormat): MatchMode {
  return format.bestOfSets <= 1 ? "MATCHPLAY" : "SETS";
}

/**
 * Die Mehrheit einer Best-of-Vorgabe. Die Vertraege verlangen ungerade Zahlen;
 * die Formel bleibt auch fuer gerade Werte die Mehrheit, damit ein
 * Bestandswert kein Unentschieden erzeugt.
 */
function majorityOf(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

export function matchTargets(format: MatchFormat): MatchTargets {
  return {
    legsToWin: majorityOf(format.bestOfLegs),
    setsToWin: majorityOf(format.bestOfSets),
  };
}
