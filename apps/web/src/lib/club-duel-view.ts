import { clubAbbreviation } from "@darts-platform/domain";
import type { ClubDuelDashboard } from "@darts-platform/schemas";
import type { StateTone } from "@darts-platform/ui";

/**
 * Reine Darstellung fuer das Vereinsduell. Nichts hier entscheidet etwas --
 * Wertung, Paarung und Sieger kommen fertig aus dem Dashboard (ADR 0021).
 */
export type ClubSide = "A" | "B";
type RoundMatchStatus = ClubDuelDashboard["rounds"][number]["matches"][number]["status"];

export function participantNames(
  participants: readonly { readonly playerId: string; readonly displayName: string }[],
): ReadonlyMap<string, string> {
  return new Map(participants.map((participant) => [participant.playerId, participant.displayName]));
}

/** Das Kuerzel steht nie allein; der Name bleibt die Wahrheit (Spec, Barrierefreiheit). */
export function sideLabel(
  settings: Pick<ClubDuelDashboard, "sideAName" | "sideBName">,
  side: ClubSide,
): { readonly name: string; readonly short: string } {
  const name = side === "A" ? settings.sideAName : settings.sideBName;
  return { name, short: clubAbbreviation(name) };
}

export function scoreLine(input: Pick<ClubDuelDashboard, "sideAName" | "sideBName" | "score">): string {
  return `${input.sideAName} ${input.score.pointsA} : ${input.score.pointsB} ${input.sideBName}`;
}

export function legsLabel(legs: readonly [number, number] | null): string {
  return legs === null ? "–" : `${legs[0]}:${legs[1]}`;
}

export function roundMatchStateLabel(status: RoundMatchStatus): { readonly tone: StateTone; readonly label: string } {
  switch (status) {
    case "WAITING":
      return { tone: "waiting", label: "offen" };
    case "READY":
      return { tone: "free", label: "bereit" };
    case "IN_PROGRESS":
      return { tone: "live", label: "läuft" };
    case "COMPLETED":
      return { tone: "finish", label: "gespielt" };
    case "BYE":
      return { tone: "finish", label: "Freilos" };
    case "CANCELLED":
      return { tone: "blocked", label: "abgesagt" };
  }
}
