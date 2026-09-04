import { COMPETITION_RULE_MESSAGES } from "@darts-platform/schemas";

/**
 * Die Übersetzung der Wettbewerbsregeln in die Fläche. Zwei Regeln zeigen auf
 * dasselbe Feld; deshalb entscheidet die Regelmeldung, nicht der Pfad.
 */

interface FormIssue {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

const ruleMessages: Readonly<Record<string, string>> = {
  [COMPETITION_RULE_MESSAGES.minNominationsCoversPositions]:
    "Die Mindestmeldung muss alle Aufstellungspositionen abdecken.",
  [COMPETITION_RULE_MESSAGES.shorthandedNotAboveMinimum]:
    "Die Ausnahmemeldung darf die reguläre Mindestmeldung nicht übersteigen.",
  [COMPETITION_RULE_MESSAGES.pointsOrdered]:
    "Die Punkte müssen geordnet sein: Sieg mindestens Unentschieden mindestens Niederlage.",
  [COMPETITION_RULE_MESSAGES.deciderBonusNeedsDecider]:
    "Ein Zusatzpunkt braucht ein Entscheidungsdoppel.",
};

const fieldMessages: Readonly<Record<string, string>> = {
  name: "Der Wettbewerb braucht einen Namen, unter dem er in der Liste auffindbar ist.",
  slug: "Der Kurzname besteht aus Kleinbuchstaben, Ziffern und Bindestrichen.",
  slots: "Die Vorlage ist widersprüchlich. Prüfe Positionen, Doppel und Distanz.",
  minNominations: "Die Mindestmeldung muss alle Aufstellungspositionen abdecken.",
  minNominationsShorthanded:
    "Die Ausnahmemeldung darf die reguläre Mindestmeldung nicht übersteigen.",
  pointsWin: "Die Punkte müssen geordnet sein: Sieg mindestens Unentschieden mindestens Niederlage.",
  pointsDeciderBonus: "Ein Zusatzpunkt braucht ein Entscheidungsdoppel.",
};

/**
 * Diese Regel braucht die gewählte Zahl, sonst widerspricht die Begründung den
 * Werten auf dem Bildschirm.
 */
function shorthandedAbovePositions(lineupPositions: number | null): string {
  return lineupPositions === null
    ? "Die Ausnahmemeldung darf die Aufstellungspositionen nicht übersteigen."
    : `Die Ausnahmemeldung darf die Aufstellungspositionen nicht übersteigen; hier sind es ${lineupPositions}.`;
}

export function competitionFormErrors(
  issues: readonly FormIssue[],
  values?: { readonly lineupPositions?: number },
): Readonly<Record<string, string>> {
  const next: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    if (issue.message === COMPETITION_RULE_MESSAGES.shorthandedNotAbovePositions) {
      next[key] = shorthandedAbovePositions(values?.lineupPositions ?? null);
      continue;
    }
    next[key] = ruleMessages[issue.message] ?? fieldMessages[key] ?? issue.message;
  }
  return next;
}

/**
 * Ein Entscheidungsdoppel greift nur bei Gleichstand. Bei einer ungeraden Zahl
 * regulärer Spiele kann es keinen geben — die Vorlage trüge dann einen Slot,
 * der nie gespielt wird.
 */
export function deciderReachability(input: {
  readonly lineupPositions: number;
  readonly regularDoubles: number;
  readonly withDecider: boolean;
}): string | null {
  if (!input.withDecider) return null;
  const regularSlots = input.lineupPositions * input.lineupPositions + input.regularDoubles;
  if (regularSlots % 2 === 0) return null;
  return `${regularSlots} reguläre Spiele können nicht unentschieden enden. Das Entscheidungsdoppel käme nie zum Einsatz.`;
}

const numberWords: Readonly<Record<number, string>> = {
  1: "Ein", 2: "Zwei", 3: "Drei", 4: "Vier", 5: "Fünf", 6: "Sechs",
};

const singlesWords: Readonly<Record<number, string>> = {
  1: "ein Einzel", 4: "vier Einzel", 9: "neun Einzel", 16: "sechzehn Einzel",
  25: "fünfundzwanzig Einzel", 36: "sechsunddreissig Einzel",
};

export function lineupPositionsHint(lineupPositions: number): string {
  const singles = lineupPositions * lineupPositions;
  const positions = numberWords[lineupPositions] ?? String(lineupPositions);
  return `${positions} Positionen ergeben ${singlesWords[singles] ?? `${singles} Einzel`}.`;
}

export function legDistanceHint(bestOfLegs: number): string {
  const wins = Math.ceil(bestOfLegs / 2);
  const word = numberWords[wins] ?? String(wins);
  return wins === 1
    ? `${word} Gewinnsatz entspricht Best of ${bestOfLegs}.`
    : `${word} Gewinnsätze entsprechen Best of ${bestOfLegs}.`;
}
