export interface CorrectionCascadeMatch {
  readonly id: string;
  readonly status: "WAITING" | "READY" | "IN_PROGRESS" | "COMPLETED" | "BYE" | "CANCELLED";
  readonly sourceOneMatchId: string | null;
  readonly sourceTwoMatchId: string | null;
}

export interface CorrectionCascadeStep {
  readonly matchId: string;
  /** Der Platz kam aus einem Spiel, das wieder offen ist: leeren. */
  readonly clearSlotOne: boolean;
  readonly clearSlotTwo: boolean;
  /** Bye oder abgesagtes Spiel: Ergebnis verwerfen, die Rückzugslogik entscheidet neu. */
  readonly reopen: boolean;
}

export type CorrectionCascade =
  | { readonly blocked: true; readonly blockingMatchId: string }
  | { readonly blocked: false; readonly steps: readonly CorrectionCascadeStep[] };

const STARTED: ReadonlySet<CorrectionCascadeMatch["status"]> = new Set(["IN_PROGRESS", "COMPLETED"]);
const AUTOMATIC: ReadonlySet<CorrectionCascadeMatch["status"]> = new Set(["BYE", "CANCELLED"]);

/**
 * Welche K.-o.-Spiele eine Resultatkorrektur mitreisst. Ein abhängiges Spiel,
 * das noch wartet, verliert nur den Platz aus dem korrigierten Spiel. Ein Bye
 * oder ein abgesagtes Spiel hat sein Ergebnis aber schon weitergegeben: Es wird
 * wieder geöffnet, und die Kette läuft weiter, bis ein wartendes Spiel sie
 * auffängt. Läuft irgendwo darin ein Spiel oder ist es abgeschlossen, ist die
 * Korrektur gesperrt – sonst stünde dort ein Teilnehmer, der nicht mehr
 * weitergekommen ist.
 */
export function planCorrectionCascade(
  matches: readonly CorrectionCascadeMatch[],
  correctedMatchId: string,
): CorrectionCascade {
  const steps = new Map<string, { matchId: string; clearSlotOne: boolean; clearSlotTwo: boolean; reopen: boolean }>();
  const queue = [correctedMatchId];
  const visited = new Set(queue);
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const sourceId = next;
    for (const dependent of matches) {
      const fromOne = dependent.sourceOneMatchId === sourceId;
      const fromTwo = dependent.sourceTwoMatchId === sourceId;
      if (!fromOne && !fromTwo) continue;
      if (STARTED.has(dependent.status)) return { blocked: true, blockingMatchId: dependent.id };
      const reopen = AUTOMATIC.has(dependent.status);
      const step = steps.get(dependent.id) ?? { matchId: dependent.id, clearSlotOne: false, clearSlotTwo: false, reopen };
      steps.set(dependent.id, { ...step, clearSlotOne: step.clearSlotOne || fromOne, clearSlotTwo: step.clearSlotTwo || fromTwo });
      if (reopen && !visited.has(dependent.id)) {
        visited.add(dependent.id);
        queue.push(dependent.id);
      }
    }
  }
  return { blocked: false, steps: [...steps.values()] };
}
