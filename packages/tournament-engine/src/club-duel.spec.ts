import { describe, expect, it } from "vitest";

import {
  CLUB_DUEL_STAGE_KEYS,
  TournamentValidationError,
  planClubDuel,
  previewClubDuel,
  type ClubDuelParticipant,
} from "./index";

export function clubParticipants(sideACount: number, sideBCount: number): ClubDuelParticipant[] {
  const sideA = Array.from({ length: sideACount }, (_, index) => ({
    playerId: `a-${index + 1}`,
    seed: index + 1,
    side: "A" as const,
  }));
  const sideB = Array.from({ length: sideBCount }, (_, index) => ({
    playerId: `b-${index + 1}`,
    seed: sideACount + index + 1,
    side: "B" as const,
  }));
  return [...sideA, ...sideB];
}

function sideOf(playerId: string): "A" | "B" {
  return playerId.startsWith("a-") ? "A" : "B";
}

describe("planClubDuel", () => {
  it("plant 13 gegen 9: Runde 1 mit 9 Spielen, 4 Pausen bei A, Finalrunde 4x4, Final und Platz 3", () => {
    const plan = planClubDuel({
      participants: clubParticipants(13, 9),
      qualifyingRounds: 4,
      finalRoundSize: 4,
      thirdPlaceMatch: true,
    });
    const qualifying = plan.matches.filter((match) => match.stageKey === CLUB_DUEL_STAGE_KEYS.qualifying);
    const finalRound = plan.matches.filter((match) => match.stageKey === CLUB_DUEL_STAGE_KEYS.finalRound);
    const final = plan.matches.filter((match) => match.stageKey === CLUB_DUEL_STAGE_KEYS.final);
    expect(qualifying).toHaveLength(9);
    expect(qualifying.every((match) => match.round === 1 && match.state === "READY")).toBe(true);
    expect(plan.roundOne.pausedPlayerIds).toEqual(["a-13", "a-12", "a-11", "a-10"]);
    expect(finalRound).toHaveLength(16);
    expect(finalRound.every((match) => match.state === "WAITING" && match.stageType === "CLUB_CROSS_ROUND_ROBIN")).toBe(true);
    expect(final.map((match) => match.key)).toEqual(["final:r1:m1", "final:r1:m2"]);
    expect(final[0]?.participantOne).toEqual({ type: "SIDE_RANK", stageKey: "final-round", side: "A", rank: 1 });
    expect(final[1]?.participantTwo).toEqual({ type: "SIDE_RANK", stageKey: "final-round", side: "B", rank: 2 });
  });

  it("setzt Runde 1 nach Seed: Seed-Rang i von A gegen Seed-Rang i von B", () => {
    const plan = planClubDuel({ participants: clubParticipants(9, 13), qualifyingRounds: 2, finalRoundSize: 2, thirdPlaceMatch: false });
    expect(plan.roundOne.pausedPlayerIds).toEqual(["b-13", "b-12", "b-11", "b-10"]);
    expect(plan.roundOne.pairings[0]).toMatchObject({ playerAId: "a-1", playerBId: "b-1", position: 1 });
    expect(plan.roundOne.pairings[8]).toMatchObject({ playerAId: "a-9", playerBId: "b-9", position: 9 });
    expect(plan.matches.filter((match) => match.stageKey === "final")).toHaveLength(1);
  });

  it("jedes geplante Spiel mit Spielern ist A gegen B, jeder spielt pro Finalrunden-Runde genau einmal", () => {
    const plan = planClubDuel({ participants: clubParticipants(8, 8), qualifyingRounds: 3, finalRoundSize: 4, thirdPlaceMatch: true });
    expect(plan.roundOne.pausedPlayerIds).toEqual([]);
    for (const match of plan.matches) {
      if (match.participantOne?.type === "PLAYER" && match.participantTwo?.type === "PLAYER") {
        expect(sideOf(match.participantOne.playerId)).toBe("A");
        expect(sideOf(match.participantTwo.playerId)).toBe("B");
      }
      if (match.participantOne?.type === "SIDE_RANK" && match.participantTwo?.type === "SIDE_RANK") {
        expect(match.participantOne.side).toBe("A");
        expect(match.participantTwo.side).toBe("B");
      }
    }
    const finalRound = plan.matches.filter((match) => match.stageKey === "final-round");
    for (const round of [1, 2, 3, 4]) {
      const inRound = finalRound.filter((match) => match.round === round);
      expect(inRound).toHaveLength(4);
      const ranksA = inRound.map((match) => (match.participantOne?.type === "SIDE_RANK" ? match.participantOne.rank : -1)).sort();
      const ranksB = inRound.map((match) => (match.participantTwo?.type === "SIDE_RANK" ? match.participantTwo.rank : -1)).sort();
      expect(ranksA).toEqual([1, 2, 3, 4]);
      expect(ranksB).toEqual([1, 2, 3, 4]);
    }
    // Runde 1 ist A1–B1, A2–B2, …; Runde r: j = ((i + r − 2) mod N) + 1
    const roundTwo = finalRound.filter((match) => match.round === 2).map((match) => [
      match.participantOne?.type === "SIDE_RANK" ? match.participantOne.rank : -1,
      match.participantTwo?.type === "SIDE_RANK" ? match.participantTwo.rank : -1,
    ]);
    expect(roundTwo).toEqual([[1, 2], [2, 3], [3, 4], [4, 1]]);
  });

  it("lehnt eine Seite kleiner als die Finalrunde ab", () => {
    expect(() => planClubDuel({ participants: clubParticipants(3, 9), qualifyingRounds: 2, finalRoundSize: 4, thirdPlaceMatch: true }))
      .toThrowError(new TournamentValidationError("CLUB_DUEL_SIDE_TOO_SMALL", "Jeder Verein braucht mindestens so viele Spieler wie die Finalrunde Plätze hat."));
  });

  it("lehnt ungültige Rundenzahlen und doppelte Spieler ab", () => {
    expect(() => planClubDuel({ participants: clubParticipants(4, 4), qualifyingRounds: 0, finalRoundSize: 2, thirdPlaceMatch: true }))
      .toThrowError(TournamentValidationError);
    expect(() => planClubDuel({ participants: clubParticipants(4, 4), qualifyingRounds: 16, finalRoundSize: 2, thirdPlaceMatch: true }))
      .toThrowError(TournamentValidationError);
    const duplicate = [...clubParticipants(4, 4), { playerId: "a-1", seed: 99, side: "B" as const }];
    expect(() => planClubDuel({ participants: duplicate, qualifyingRounds: 2, finalRoundSize: 2, thirdPlaceMatch: true }))
      .toThrowError(new TournamentValidationError("DUPLICATE_PARTICIPANT", "A participant may only appear once."));
  });
});

describe("previewClubDuel", () => {
  it("rechnet 13/9 mit 4 Runden, N=4, Platz 3 auf 8 Scheiben", () => {
    const preview = previewClubDuel({ sideACount: 13, sideBCount: 9, qualifyingRounds: 4, finalRoundSize: 4, thirdPlaceMatch: true, boardCount: 8, bestOfLegs: 3 });
    expect(preview).toEqual({
      qualifyingMatches: 36,
      finalRoundMatches: 16,
      finalMatches: 2,
      totalMatches: 54,
      matchesPerPlayer: { sideA: { min: 2, max: 3 }, sideB: { min: 4, max: 4 } },
      estimatedMinutes: 7 * 12,
      warnings: [],
    });
  });

  it("warnt, wenn Wiederholungen unvermeidbar werden, und lehnt zu grosse Finalrunden ab", () => {
    const preview = previewClubDuel({ sideACount: 4, sideBCount: 4, qualifyingRounds: 5, finalRoundSize: 2, thirdPlaceMatch: false, boardCount: 2, bestOfLegs: 3 });
    expect(preview.warnings).toEqual(["Ab Runde 5 sind Wiederholungen von Paarungen unvermeidbar."]);
    expect(() => previewClubDuel({ sideACount: 3, sideBCount: 9, qualifyingRounds: 2, finalRoundSize: 4, thirdPlaceMatch: true, boardCount: 2, bestOfLegs: 3 }))
      .toThrowError(TournamentValidationError);
  });
});
