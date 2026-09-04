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

  it("orders by points before game difference", () => {
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

  it("breaks equal points by game difference, then by leg difference", () => {
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
