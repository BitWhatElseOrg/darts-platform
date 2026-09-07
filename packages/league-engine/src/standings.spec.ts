import { describe, expect, it } from "vitest";

import { calculateStandings, type StandingsEncounter } from "./standings";

const HOME = "team-home";
const AWAY = "team-away";
const THIRD = "team-third";
const FOURTH = "team-fourth";

function encounter(overrides: Partial<StandingsEncounter> = {}): StandingsEncounter {
  return {
    homeTeamId: HOME,
    awayTeamId: AWAY,
    status: "COMPLETED",
    result: "HOME_WIN",
    homePoints: 3,
    awayPoints: 0,
    homeGames: 3,
    awayGames: 2,
    homeLegs: 3,
    awayLegs: 2,
    ...overrides,
  };
}

describe("calculateStandings", () => {
  it("lists every team even before a single encounter is played", () => {
    const table = calculateStandings({ teamIds: [HOME, AWAY], encounters: [] });

    expect(table).toHaveLength(2);
    expect(table.every((row) => row.played === 0 && row.points === 0 && row.rank === 1)).toBe(true);
  });

  it("counts only completed encounters", () => {
    const table = calculateStandings({
      teamIds: [HOME, AWAY],
      encounters: [encounter({ status: "RUNNING" })],
    });

    expect(table.every((row) => row.played === 0 && row.points === 0)).toBe(true);
  });

  it("books points, games and legs on both sides of a completed encounter", () => {
    const [first, second] = calculateStandings({
      teamIds: [HOME, AWAY],
      encounters: [encounter()],
    });

    expect(first).toMatchObject({
      teamId: HOME, played: 1, won: 1, drawn: 0, lost: 0, points: 3,
      gamesFor: 3, gamesAgainst: 2, gameDifference: 1,
      legsFor: 3, legsAgainst: 2, legDifference: 1, rank: 1,
    });
    expect(second).toMatchObject({
      teamId: AWAY, played: 1, won: 0, drawn: 0, lost: 1, points: 0,
      gamesFor: 2, gamesAgainst: 3, gameDifference: -1,
      legsFor: 2, legsAgainst: 3, legDifference: -1, rank: 2,
    });
  });

  it("books a draw on both sides", () => {
    const table = calculateStandings({
      teamIds: [HOME, AWAY],
      encounters: [
        encounter({ result: "DRAW", homePoints: 1, awayPoints: 1, homeGames: 3, awayGames: 3 }),
      ],
    });

    expect(table.every((row) => row.drawn === 1 && row.points === 1 && row.won === 0)).toBe(true);
  });

  it("ordnet zuerst nach Pluspunkten (A1.5, Kriterium 1)", () => {
    // Der Dritte hat die bessere Differenz, aber weniger Punkte.
    const table = calculateStandings({
      teamIds: [HOME, THIRD, AWAY, FOURTH],
      encounters: [
        encounter({ homeTeamId: HOME, awayTeamId: AWAY }),
        encounter({
          homeTeamId: THIRD, awayTeamId: FOURTH, result: "DRAW",
          homePoints: 1, awayPoints: 1, homeGames: 9, awayGames: 0, homeLegs: 9, awayLegs: 0,
        }),
      ],
    });

    expect(table.map((row) => row.teamId).slice(0, 2)).toEqual([HOME, THIRD]);
  });

  it("bricht Punktgleichheit über gewonnene Spiele (A1.5, Kriterium 3)", () => {
    const table = calculateStandings({
      teamIds: [HOME, THIRD],
      encounters: [
        encounter({ homeTeamId: HOME, awayTeamId: AWAY, homeGames: 3, awayGames: 2, homeLegs: 6, awayLegs: 5 }),
        encounter({ homeTeamId: THIRD, awayTeamId: FOURTH, homeGames: 4, awayGames: 1, homeLegs: 6, awayLegs: 5 }),
      ],
    });

    expect(table.map((row) => row.teamId)).toEqual([THIRD, HOME]);
  });

  it("shares a rank between teams with an identical record", () => {
    const table = calculateStandings({
      teamIds: [HOME, THIRD, AWAY, FOURTH],
      encounters: [
        encounter({ homeTeamId: HOME, awayTeamId: AWAY }),
        encounter({ homeTeamId: THIRD, awayTeamId: FOURTH }),
      ],
    });

    expect(table.map((row) => row.rank)).toEqual([1, 1, 3, 3]);
  });

  it("ignores encounters of teams outside the competition", () => {
    const table = calculateStandings({
      teamIds: [HOME],
      encounters: [encounter({ homeTeamId: "fremd", awayTeamId: "auch-fremd" })],
    });

    expect(table).toHaveLength(1);
    expect(table[0]).toMatchObject({ teamId: HOME, played: 0 });
  });
});

function homeEncounter(
  teamId: string,
  opponentId: string,
  values: {
    readonly points: number;
    readonly opponentPoints: number;
    readonly games: number;
    readonly gamesAgainst: number;
    readonly legs: number;
    readonly legsAgainst: number;
  },
): StandingsEncounter {
  return {
    homeTeamId: teamId,
    awayTeamId: opponentId,
    status: "COMPLETED",
    result:
      values.games > values.gamesAgainst
        ? "HOME_WIN"
        : values.games < values.gamesAgainst
          ? "AWAY_WIN"
          : "DRAW",
    homePoints: values.points,
    awayPoints: values.opponentPoints,
    homeGames: values.games,
    awayGames: values.gamesAgainst,
    homeLegs: values.legs,
    awayLegs: values.legsAgainst,
  };
}

describe("Rangierungskriterien nach Reglement A1.5", () => {
  // Team A: fünf reguläre Begegnungen à 18 Spielen, drei klare Siege (3:0),
  // zwei klare Niederlagen (0:3) -> 9 Pluspunkte, 6 Minuspunkte, 48:42 Spiele.
  const teamA: readonly StandingsEncounter[] = [
    homeEncounter("a", "gegner-1", { points: 3, opponentPoints: 0, games: 11, gamesAgainst: 7, legs: 18, legsAgainst: 12 }),
    homeEncounter("a", "gegner-2", { points: 3, opponentPoints: 0, games: 11, gamesAgainst: 7, legs: 18, legsAgainst: 12 }),
    homeEncounter("a", "gegner-3", { points: 3, opponentPoints: 0, games: 10, gamesAgainst: 8, legs: 16, legsAgainst: 14 }),
    homeEncounter("a", "gegner-4", { points: 0, opponentPoints: 3, games: 8, gamesAgainst: 10, legs: 15, legsAgainst: 16 }),
    homeEncounter("a", "gegner-5", { points: 0, opponentPoints: 3, games: 8, gamesAgainst: 10, legs: 15, legsAgainst: 16 }),
  ];
  // Team B: drei Begegnungen mit sudden death (10:9 Spiele, 2:1 Punkte), ein
  // klarer Sieg, eine klare Niederlage -> ebenfalls 9 Pluspunkte und 6
  // Minuspunkte, aber 49:44 Spiele.
  const teamB: readonly StandingsEncounter[] = [
    homeEncounter("b", "gegner-1", { points: 2, opponentPoints: 1, games: 10, gamesAgainst: 9, legs: 17, legsAgainst: 15 }),
    homeEncounter("b", "gegner-2", { points: 2, opponentPoints: 1, games: 10, gamesAgainst: 9, legs: 17, legsAgainst: 15 }),
    homeEncounter("b", "gegner-3", { points: 2, opponentPoints: 1, games: 10, gamesAgainst: 9, legs: 17, legsAgainst: 15 }),
    homeEncounter("b", "gegner-4", { points: 3, opponentPoints: 0, games: 11, gamesAgainst: 7, legs: 17, legsAgainst: 13 }),
    homeEncounter("b", "gegner-5", { points: 0, opponentPoints: 3, games: 8, gamesAgainst: 10, legs: 12, legsAgainst: 16 }),
  ];

  it("stellt bei gleichen Plus- und Minuspunkten die Mannschaft mit mehr gewonnenen Spielen vor (Kriterium 3)", () => {
    const table = calculateStandings({ teamIds: ["a", "b"], encounters: [...teamA, ...teamB] });

    expect(table.map((row) => row.teamId)).toEqual(["b", "a"]);
    expect(table[0]).toMatchObject({
      teamId: "b", points: 9, minusPoints: 6, gamesFor: 49, gamesAgainst: 44, legsFor: 80, legsAgainst: 74, rank: 1,
    });
    expect(table[1]).toMatchObject({
      teamId: "a", points: 9, minusPoints: 6, gamesFor: 48, gamesAgainst: 42, legsFor: 82, legsAgainst: 70, rank: 2,
    });
  });

  it("stellt bei gleichen Pluspunkten die Mannschaft mit weniger Minuspunkten vor (Kriterium 2 schlägt Kriterium 3)", () => {
    // Team C: drei klare Siege, keine Niederlage -> 9 Pluspunkte, 0 Minuspunkte,
    // aber nur 33 gewonnene Spiele gegen 48 von Team A.
    const teamC: readonly StandingsEncounter[] = [
      homeEncounter("c", "gegner-1", { points: 3, opponentPoints: 0, games: 11, gamesAgainst: 7, legs: 18, legsAgainst: 12 }),
      homeEncounter("c", "gegner-2", { points: 3, opponentPoints: 0, games: 11, gamesAgainst: 7, legs: 18, legsAgainst: 12 }),
      homeEncounter("c", "gegner-3", { points: 3, opponentPoints: 0, games: 11, gamesAgainst: 7, legs: 18, legsAgainst: 12 }),
    ];
    const table = calculateStandings({ teamIds: ["a", "c"], encounters: [...teamA, ...teamC] });

    expect(table.map((row) => row.teamId)).toEqual(["c", "a"]);
    expect(table[0]).toMatchObject({ teamId: "c", points: 9, minusPoints: 0, gamesFor: 33 });
    expect(table[1]).toMatchObject({ teamId: "a", points: 9, minusPoints: 6, gamesFor: 48 });
  });
});
