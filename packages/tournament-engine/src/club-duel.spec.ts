import { describe, expect, it } from "vitest";

import {
  CLUB_DUEL_STAGE_KEYS,
  TournamentValidationError,
  calculateClubScore,
  calculateClubStandings,
  calculateCrossRoundStandings,
  pairClubSwissRound,
  planClubDuel,
  previewClubDuel,
  type ClubDuelParticipant,
  type ClubMatchResult,
  type ClubRankedPlayer,
  type ClubSwissPairingInput,
  type ClubSwissRound,
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

function ranked(prefix: string, count: number, seedOffset = 0): ClubRankedPlayer[] {
  return Array.from({ length: count }, (_, index) => ({ playerId: `${prefix}-${index + 1}`, seed: seedOffset + index + 1 }));
}

/** Spielt `rounds` Runden durch; Rangfolge bleibt die Seed-Folge (nur die Paarungslogik steht im Test). */
function simulateRounds(sideA: ClubRankedPlayer[], sideB: ClubRankedPlayer[], rounds: number) {
  const pauses = new Map<string, number>();
  const played = new Map<string, number>();
  const previous: { playerAId: string; playerBId: string }[] = [];
  const result: ClubSwissRound[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const paired = pairClubSwissRound({ round, sideA, sideB, previousPairings: previous, pauses, played });
    for (const id of paired.pausedPlayerIds) pauses.set(id, (pauses.get(id) ?? 0) + 1);
    for (const pairing of paired.pairings) {
      played.set(pairing.playerAId, (played.get(pairing.playerAId) ?? 0) + 1);
      played.set(pairing.playerBId, (played.get(pairing.playerBId) ?? 0) + 1);
      previous.push({ playerAId: pairing.playerAId, playerBId: pairing.playerBId });
    }
    result.push(paired);
  }
  return { rounds: result, pauses, played };
}

describe("pairClubSwissRound", () => {
  it("rotiert die Pausen bei 13 gegen 9 über 4 Runden gleichmässig", () => {
    const { rounds, pauses } = simulateRounds(ranked("a", 13), ranked("b", 9, 13), 4);
    expect(rounds[0]?.pausedPlayerIds).toEqual(["a-13", "a-12", "a-11", "a-10"]);
    expect(rounds[1]?.pausedPlayerIds).toEqual(["a-9", "a-8", "a-7", "a-6"]);
    expect(rounds[2]?.pausedPlayerIds).toEqual(["a-5", "a-4", "a-3", "a-2"]);
    // Runde 4: a-1 ist der Einzige mit 0 Pausen; alle anderen haben 1 Pause und 2 Spiele → höchste Seed-Nummern
    expect(rounds[3]?.pausedPlayerIds).toEqual(["a-1", "a-13", "a-12", "a-11"]);
    for (let index = 1; index <= 13; index += 1) {
      expect(pauses.get(`a-${index}`) ?? 0).toBeGreaterThanOrEqual(1);
      expect(pauses.get(`a-${index}`) ?? 0).toBeLessThanOrEqual(2);
    }
    expect([...pauses.keys()].some((id) => id.startsWith("b-"))).toBe(false);
  });

  it("vermeidet Wiederholungen, solange es aufgeht, und meldet sie danach als Warnung", () => {
    const sideA = ranked("a", 4);
    const sideB = ranked("b", 4, 4);
    const { rounds } = simulateRounds(sideA, sideB, 5);
    for (const round of rounds.slice(0, 4)) {
      expect(round.pairings.every((pairing) => !pairing.repeated)).toBe(true);
      expect(round.warnings).toEqual([]);
    }
    const fifth = rounds[4];
    expect(fifth?.pairings.filter((pairing) => pairing.repeated)).toHaveLength(4);
    expect(fifth?.warnings).toEqual(["Runde 5: 4 Paarungen wiederholen sich, weil keine neuen Gegner mehr frei sind."]);
  });

  it("meldet eine einzelne erzwungene Wiederholung im Singular", () => {
    // 2×2: Frei ist nur a-2/b-1. Zuordnung (a-1/b-2, a-2/b-1) hat 1 Wiederholung, (a-1/b-1, a-2/b-2) hätte 2.
    const paired = pairClubSwissRound({
      round: 4,
      sideA: ranked("a", 2),
      sideB: ranked("b", 2, 2),
      previousPairings: [
        { playerAId: "a-1", playerBId: "b-1" },
        { playerAId: "a-2", playerBId: "b-2" },
        { playerAId: "a-1", playerBId: "b-2" },
      ],
      pauses: new Map(),
      played: new Map(),
    });
    expect(paired.pairings.map((pairing) => [pairing.playerAId, pairing.playerBId, pairing.repeated])).toEqual([
      ["a-1", "b-2", true],
      ["a-2", "b-1", false],
    ]);
    expect(paired.warnings).toEqual(["Runde 4: 1 Paarung wiederholt sich, weil keine neuen Gegner mehr frei sind."]);
  });

  it("paart nahe Ränge: nach Rang sortierte Seiten ergeben Rang i gegen Rang i, wenn keine Wiederholung droht", () => {
    const paired = pairClubSwissRound({
      round: 2,
      sideA: ranked("a", 3),
      sideB: ranked("b", 3, 3),
      previousPairings: [],
      pauses: new Map(),
      played: new Map(),
    });
    expect(paired.pairings.map((pairing) => [pairing.playerAId, pairing.playerBId])).toEqual([["a-1", "b-1"], ["a-2", "b-2"], ["a-3", "b-3"]]);
  });

  it("weicht minimal aus, wenn Rang i gegen Rang i eine Wiederholung wäre", () => {
    const paired = pairClubSwissRound({
      round: 2,
      sideA: ranked("a", 3),
      sideB: ranked("b", 3, 3),
      previousPairings: [{ playerAId: "a-1", playerBId: "b-1" }],
      pauses: new Map(),
      played: new Map(),
    });
    expect(paired.pairings.every((pairing) => !pairing.repeated)).toBe(true);
    expect(paired.pairings.find((pairing) => pairing.playerAId === "a-1")?.playerBId).toBe("b-2");
  });

  it("ist deterministisch", () => {
    const input: ClubSwissPairingInput = { round: 3, sideA: ranked("a", 7), sideB: ranked("b", 5, 7), previousPairings: [{ playerAId: "a-2", playerBId: "b-2" }], pauses: new Map([["a-7", 1]]), played: new Map([["a-7", 1]]) };
    expect(pairClubSwissRound(input)).toEqual(pairClubSwissRound(input));
  });

  it("Property: nie zweimal pro Runde, nie A gegen A, Pausen gleichmässig (zufällige Grössen 2–32)", () => {
    let state = 12345;
    const next = () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    for (let iteration = 0; iteration < 40; iteration += 1) {
      const sizeA = 2 + Math.floor(next() * 31);
      const sizeB = 2 + Math.floor(next() * 31);
      const rounds = 1 + Math.floor(next() * 6);
      const sideA = ranked("a", sizeA);
      const sideB = ranked("b", sizeB, sizeA);
      const pauses = new Map<string, number>();
      const played = new Map<string, number>();
      const previous: { playerAId: string; playerBId: string }[] = [];
      for (let round = 1; round <= rounds; round += 1) {
        // zufällige Rangfolge wie nach echten Ergebnissen
        const shuffledA = [...sideA].sort(() => next() - 0.5);
        const shuffledB = [...sideB].sort(() => next() - 0.5);
        const paired = pairClubSwissRound({ round, sideA: shuffledA, sideB: shuffledB, previousPairings: previous, pauses, played });
        const seen = new Set<string>();
        for (const pairing of paired.pairings) {
          expect(pairing.playerAId.startsWith("a-")).toBe(true);
          expect(pairing.playerBId.startsWith("b-")).toBe(true);
          expect(seen.has(pairing.playerAId)).toBe(false);
          expect(seen.has(pairing.playerBId)).toBe(false);
          seen.add(pairing.playerAId);
          seen.add(pairing.playerBId);
          played.set(pairing.playerAId, (played.get(pairing.playerAId) ?? 0) + 1);
          played.set(pairing.playerBId, (played.get(pairing.playerBId) ?? 0) + 1);
          previous.push({ playerAId: pairing.playerAId, playerBId: pairing.playerBId });
        }
        expect(paired.pairings).toHaveLength(Math.min(sizeA, sizeB));
        expect(paired.pausedPlayerIds).toHaveLength(Math.abs(sizeA - sizeB));
        for (const id of paired.pausedPlayerIds) {
          expect(seen.has(id)).toBe(false);
          pauses.set(id, (pauses.get(id) ?? 0) + 1);
        }
      }
      const largerPrefix = sizeA >= sizeB ? "a-" : "b-";
      const larger = sizeA >= sizeB ? sideA : sideB;
      const pauseValues = larger.map((player) => pauses.get(player.playerId) ?? 0);
      expect(Math.max(...pauseValues) - Math.min(...pauseValues)).toBeLessThanOrEqual(1);
      expect([...pauses.keys()].every((id) => id.startsWith(largerPrefix))).toBe(true);
    }
  });
});

const played = (a: string, b: string, legsA: number, legsB: number): ClubMatchResult => ({
  type: "PLAYED", playerOneId: a, playerTwoId: b, playerOneLegs: legsA, playerTwoLegs: legsB, winnerPlayerId: legsA > legsB ? a : b,
});
const walkover = (a: string, b: string, winner: string): ClubMatchResult => ({
  type: "WALKOVER", playerOneId: a, playerTwoId: b, playerOneLegs: 0, playerTwoLegs: 0, winnerPlayerId: winner,
});

describe("calculateClubStandings", () => {
  const participants = clubParticipants(3, 2);

  it("schreibt den Sieg dem gespeicherten Sieger gut, auch wenn er weniger Legs hat (Saetze)", () => {
    const standings = calculateClubStandings({
      participants,
      results: [{ type: "PLAYED", playerOneId: "a-1", playerTwoId: "b-1", playerOneLegs: 2, playerTwoLegs: 0, winnerPlayerId: "b-1" }],
    });
    expect(standings.sideB.find((row) => row.playerId === "b-1")?.won).toBe(1);
    expect(standings.sideA.find((row) => row.playerId === "a-1")?.lost).toBe(1);
  });

  it("akzeptiert 4:4 Legs mit Sieger (Saetze 2-1, 0-2, 2-1)", () => {
    const standings = calculateClubStandings({
      participants,
      results: [{ type: "PLAYED", playerOneId: "a-1", playerTwoId: "b-1", playerOneLegs: 4, playerTwoLegs: 4, winnerPlayerId: "a-1" }],
    });
    expect(standings.sideA.find((row) => row.playerId === "a-1")?.won).toBe(1);
  });

  it("lehnt ein PLAYED-Resultat mit fremdem Sieger ab", () => {
    expect(() => calculateClubStandings({
      participants,
      results: [{ type: "PLAYED", playerOneId: "a-1", playerTwoId: "b-1", playerOneLegs: 2, playerTwoLegs: 0, winnerPlayerId: "a-2" }],
    })).toThrowError(new TournamentValidationError("INVALID_GROUP_RESULT", "A result is invalid."));
  });

  it("ordnet bei gleicher Siegquote und Legdifferenz pro Spiel nach Legs pro Spiel", () => {
    const standings = calculateClubStandings({
      participants: clubParticipants(2, 2),
      results: [
        played("a-2", "b-1", 3, 2), // a-2: 1/1, +1, 3 Legs ; b-1: 0/1
        played("a-1", "b-2", 2, 1), // a-1: 1/1, +1, 2 Legs ; b-2: 0/1
      ],
    });
    // Quote: a-2 und a-1 je 1/1; Legdifferenz pro Spiel: beide +1; Legs pro Spiel: a-2 3 vs a-1 2
    expect(standings.overall.map((row) => row.playerId)).toEqual(["a-2", "a-1", "b-1", "b-2"]);
  });

  it("ordnet nach Siegquote, dann Legdifferenz pro Spiel, dann Legs pro Spiel, dann Seed", () => {
    const standings = calculateClubStandings({
      participants,
      results: [
        played("a-1", "b-1", 2, 0), // a-1: 1/1, +2
        played("a-2", "b-2", 2, 1), // a-2: 1/1, +1
        played("a-3", "b-1", 0, 2), // a-3: 0/1
        played("a-1", "b-2", 0, 2), // a-1: 1/2, Legs 2:2 ; b-2: 1/2, Legs 3:2
      ],
    });
    // Quote 1: a-2. Quote ½: b-2 (+0,5 pro Spiel) vor a-1 und b-1 (je 0, je 1 Leg pro Spiel) → Seed 1 vor Seed 4. Zuletzt a-3 (Quote 0).
    expect(standings.overall.map((row) => row.playerId)).toEqual(["a-2", "b-2", "a-1", "b-1", "a-3"]);
    expect(standings.overall[0]).toMatchObject({ position: 1, side: "A", played: 1, won: 1, lost: 0, legsFor: 2, legsAgainst: 1, winRate: 1, legDifferencePerMatch: 1, withdrawn: false });
    expect(standings.sideA.map((row) => [row.position, row.playerId])).toEqual([[1, "a-2"], [2, "a-1"], [3, "a-3"]]);
    expect(standings.sideB.map((row) => [row.position, row.playerId])).toEqual([[1, "b-2"], [2, "b-1"]]);
  });

  it("stellt Spieler ohne Spiel hinter alle mit Spiel und markiert Zurückgezogene", () => {
    const standings = calculateClubStandings({
      participants,
      results: [played("a-3", "b-2", 0, 2)],
      withdrawnPlayerIds: ["a-3"],
    });
    expect(standings.overall.map((row) => row.playerId)).toEqual(["b-2", "a-3", "a-1", "a-2", "b-1"]);
    expect(standings.overall.find((row) => row.playerId === "a-3")?.withdrawn).toBe(true);
  });

  it("zählt Walkover als Sieg ohne Legs", () => {
    const standings = calculateClubStandings({ participants, results: [walkover("a-1", "b-1", "b-1")] });
    expect(standings.overall[0]).toMatchObject({ playerId: "b-1", won: 1, legsFor: 0, legsAgainst: 0, winRate: 1 });
    expect(standings.overall.find((row) => row.playerId === "a-1")).toMatchObject({ played: 1, lost: 1, winRate: 0 });
  });

  it("lehnt ein Resultat innerhalb desselben Vereins oder mit Unbekannten ab", () => {
    expect(() => calculateClubStandings({ participants, results: [played("a-1", "a-2", 2, 0)] }))
      .toThrowError(new TournamentValidationError("CLUB_DUEL_SAME_SIDE_PAIRING", "Ein Spiel muss zwischen den beiden Vereinen stattfinden."));
    expect(() => calculateClubStandings({ participants, results: [played("a-1", "x-9", 2, 0)] }))
      .toThrowError(TournamentValidationError);
  });
});

describe("calculateCrossRoundStandings", () => {
  it("ordnet je Verein nach Siegen, Legdifferenz, Quali-Rang und zählt kampflose Siege", () => {
    const standings = calculateCrossRoundStandings({
      sideA: [{ playerId: "a-1", qualifyingRank: 1 }, { playerId: "a-2", qualifyingRank: 2 }],
      sideB: [{ playerId: "b-1", qualifyingRank: 1 }, { playerId: "b-2", qualifyingRank: 2 }],
      results: [
        played("a-1", "b-1", 2, 1),
        played("a-2", "b-2", 2, 0),
        played("a-1", "b-2", 1, 2),
        played("a-2", "b-1", 0, 2),
      ],
      unopposedWalkoverWinnerIds: ["b-2"],
    });
    // a-1: 1 Sieg, +0 ; a-2: 1 Sieg, +0 → Quali-Rang entscheidet
    expect(standings.sideA.map((row) => [row.position, row.playerId])).toEqual([[1, "a-1"], [2, "a-2"]]);
    // b-2: 2 Siege (1 davon kampflos), b-1: 1 Sieg
    expect(standings.sideB.map((row) => [row.position, row.playerId, row.won, row.played])).toEqual([[1, "b-2", 2, 3], [2, "b-1", 1, 2]]);
  });
});

describe("calculateClubScore", () => {
  const sideOf = new Map(clubParticipants(2, 2).map((participant) => [participant.playerId, participant.side]));

  it("vergibt einen Punkt pro Spiel und führt die Legdifferenz; Summe = Spiele", () => {
    const results = [played("a-1", "b-1", 2, 0), played("a-2", "b-2", 1, 2), walkover("a-1", "b-2", "a-1")];
    const score = calculateClubScore({ sideOf, results });
    expect(score).toEqual({ pointsA: 2, pointsB: 1, legDifferenceA: 1, leader: "A" });
    expect(score.pointsA + score.pointsB).toBe(results.length);
  });

  it("entscheidet Gleichstand über die Legdifferenz, sonst TIED", () => {
    expect(calculateClubScore({ sideOf, results: [played("a-1", "b-1", 2, 0), played("a-2", "b-2", 1, 2)] }).leader).toBe("A");
    expect(calculateClubScore({ sideOf, results: [played("a-1", "b-1", 2, 1), played("a-2", "b-2", 1, 2)] })).toEqual({ pointsA: 1, pointsB: 1, legDifferenceA: 0, leader: "TIED" });
    expect(calculateClubScore({ sideOf, results: [], unopposedWalkoverWinnerIds: ["b-1"] })).toEqual({ pointsA: 0, pointsB: 1, legDifferenceA: 0, leader: "B" });
  });
});

describe("pairClubSwissRound – Optimalität", () => {
  it("findet für n ≤ 6 dieselbe minimale Kostensumme wie eine erschöpfende Suche", () => {
    let state = 4242;
    const next = () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    const permutations = (items: readonly number[]): number[][] =>
      items.length <= 1
        ? [[...items]]
        : items.flatMap((item, index) =>
            permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
          );
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const n = 2 + Math.floor(next() * 5);
      const sideA = ranked("a", n);
      const sideB = ranked("b", n, n);
      const previous = sideA.flatMap((a) =>
        sideB.filter(() => next() < 0.3).map((b) => ({ playerAId: a.playerId, playerBId: b.playerId })),
      );
      const previousSet = new Set(previous.map((pair) => `${pair.playerAId}:${pair.playerBId}`));
      const penalty = n * n + 1;
      const cost = (i: number, j: number) =>
        Math.abs(i - j) + (previousSet.has(`${sideA[i]?.playerId}:${sideB[j]?.playerId}`) ? penalty : 0);
      const best = Math.min(
        ...permutations(sideB.map((_, j) => j)).map((perm) => perm.reduce((sum, j, i) => sum + cost(i, j), 0)),
      );
      const paired = pairClubSwissRound({ round: 2, sideA, sideB, previousPairings: previous, pauses: new Map(), played: new Map() });
      const actual = paired.pairings.reduce(
        (sum, pairing) =>
          sum +
          cost(
            sideA.findIndex((a) => a.playerId === pairing.playerAId),
            sideB.findIndex((b) => b.playerId === pairing.playerBId),
          ),
        0,
      );
      expect(paired.pairings).toHaveLength(n);
      expect(actual).toBe(best);
    }
  });
});

describe("Validierung", () => {
  it("lehnt doppelte Seeds und leere Seiten ab", () => {
    const duplicateSeed = [...clubParticipants(2, 2).slice(0, 3), { playerId: "b-2", seed: 1, side: "B" as const }];
    expect(() => planClubDuel({ participants: duplicateSeed, qualifyingRounds: 1, finalRoundSize: 2, thirdPlaceMatch: false }))
      .toThrowError(new TournamentValidationError("DUPLICATE_SEED", "Every seed must be unique."));
    expect(() => planClubDuel({ participants: clubParticipants(3, 0), qualifyingRounds: 1, finalRoundSize: 2, thirdPlaceMatch: false }))
      .toThrowError(new TournamentValidationError("CLUB_DUEL_SIDE_EMPTY", "Beide Vereine brauchen mindestens einen Spieler."));
    expect(() => previewClubDuel({ sideACount: 4, sideBCount: 4, qualifyingRounds: 2, finalRoundSize: 2, thirdPlaceMatch: false, boardCount: 0, bestOfLegs: 3 }))
      .toThrowError(new TournamentValidationError("INVALID_STRUCTURE", "Mindestens eine Scheibe ist nötig."));
  });

  it("Kreuzwertung: Walkover zählt ohne Legs, doppelte Teilnehmer werden abgelehnt", () => {
    const standings = calculateCrossRoundStandings({
      sideA: [{ playerId: "a-1", qualifyingRank: 1 }],
      sideB: [{ playerId: "b-1", qualifyingRank: 1 }],
      results: [walkover("a-1", "b-1", "b-1")],
    });
    expect(standings.sideB[0]).toMatchObject({ won: 1, legsFor: 0, legsAgainst: 0 });
    const duplicate = new TournamentValidationError("DUPLICATE_PARTICIPANT", "A participant may only appear once.");
    expect(() => calculateCrossRoundStandings({ sideA: [{ playerId: "x", qualifyingRank: 1 }], sideB: [{ playerId: "x", qualifyingRank: 1 }], results: [] }))
      .toThrowError(duplicate);
    expect(() => calculateCrossRoundStandings({
      sideA: [{ playerId: "a-1", qualifyingRank: 1 }, { playerId: "a-1", qualifyingRank: 2 }],
      sideB: [{ playerId: "b-1", qualifyingRank: 1 }],
      results: [],
    })).toThrowError(duplicate);
  });

  it("Kreuzwertung: doppelte kampflose Siege zählen je Eintrag", () => {
    const standings = calculateCrossRoundStandings({
      sideA: [{ playerId: "a-1", qualifyingRank: 1 }],
      sideB: [{ playerId: "b-1", qualifyingRank: 1 }],
      results: [],
      unopposedWalkoverWinnerIds: ["a-1", "a-1"],
    });
    expect(standings.sideA[0]).toMatchObject({ played: 2, won: 2 });
  });
});
