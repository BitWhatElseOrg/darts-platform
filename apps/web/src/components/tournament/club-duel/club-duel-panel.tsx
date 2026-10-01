"use client";

import type { ClubDuelDashboard } from "@darts-platform/schemas";

import { participantNames } from "@/lib/club-duel-view";

import { ClubDuelTabs } from "./club-duel-tabs";
import { ClubFinalRound } from "./club-final-round";
import { ClubRounds } from "./club-rounds";
import { ClubStandings } from "./club-standings";

export type ClubDuelTabId = "rounds" | "standings" | "final";

/** Runden, Rangliste und Finalrunde eines Vereinsduells als Tabs. */
export function ClubDuelPanel({ clubDuel, participants, defaultTab = "rounds" }: {
  readonly clubDuel: ClubDuelDashboard;
  readonly participants: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly defaultTab?: ClubDuelTabId;
}) {
  const names = participantNames(participants);
  return (
    <ClubDuelTabs
      initial={defaultTab}
      tabs={[
        { id: "rounds", label: "Runden", panel: <ClubRounds clubDuel={clubDuel} names={names} /> },
        { id: "standings", label: "Rangliste", focusable: true, panel: <ClubStandings clubDuel={clubDuel} /> },
        { id: "final", label: "Finalrunde", focusable: true, panel: <ClubFinalRound clubDuel={clubDuel} names={names} /> },
      ]}
    />
  );
}

/** Welcher Tab zum Turnierstatus passt – Aufrufer reichen das Ergebnis als `defaultTab`. */
export function clubDuelTabForStatus(status: string): ClubDuelTabId {
  return status === "FINAL_ROUND" || status === "KNOCKOUT" || status === "COMPLETED" ? "final" : "rounds";
}
