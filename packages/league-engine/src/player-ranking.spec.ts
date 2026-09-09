import { describe, expect, it } from "vitest";

import { calculatePlayerRanking, type PlayerRankingSlot } from "./player-ranking.js";

const TEAM_A = "team-a";
const TEAM_B = "team-b";
const ALICE = "player-alice";
const BOB = "player-bob";
const CARLA = "player-carla";

function singles(overrides: Partial<PlayerRankingSlot> = {}): PlayerRankingSlot {
  return {
    encounterId: "encounter-1",
    encounterStatus: "COMPLETED",
    matchday: 1,
    discipline: "SINGLES",
    status: "COMPLETED",
    legsToWinSet: 2,
    homeTeamId: TEAM_A,
    awayTeamId: TEAM_B,
    homePlayerIds: [ALICE],
    awayPlayerIds: [BOB],
    homeLegs: 2,
    awayLegs: 0,
    ...overrides,
  };
}

describe("calculatePlayerRanking", () => {
  it("gibt eine leere Liste ohne gewertete Slots zurück", () => {
    expect(calculatePlayerRanking({ slots: [] })).toEqual([]);
  });

  it("rechnet die Punktetabelle nach Reglement A1.7 für alle vier Satzausgänge", () => {
    const cases: readonly [number, number, number, number][] = [
      // [homeLegs, awayLegs, erwartete Heimpunkte, erwartete Gastpunkte]
      [2, 0, 4, 0],
      [2, 1, 3, 1],
      [1, 2, 1, 3],
      [0, 2, 0, 4],
    ];
    for (const [homeLegs, awayLegs, homePoints, awayPoints] of cases) {
      const rows = calculatePlayerRanking({
        slots: [singles({ homeLegs, awayLegs })],
      });
      const alice = rows.find((row) => row.playerId === ALICE);
      const bob = rows.find((row) => row.playerId === BOB);
      expect(alice).toMatchObject({ achievedPoints: homePoints, possiblePoints: 4 });
      expect(bob).toMatchObject({ achievedPoints: awayPoints, possiblePoints: 4 });
    }
  });

  it("zählt Doppelslots nicht (Spec-Entscheid: nur Einzel)", () => {
    const rows = calculatePlayerRanking({
      slots: [singles({ discipline: "DOUBLES", homePlayerIds: [ALICE, CARLA], awayPlayerIds: [BOB] })],
    });
    expect(rows).toEqual([]);
  });

  it("zählt nur Begegnungen mit Status COMPLETED", () => {
    const rows = calculatePlayerRanking({
      slots: [singles({ encounterStatus: "RUNNING" })],
    });
    expect(rows).toEqual([]);
  });

  it("zählt CANCELLED-Slots nicht (Nichtantritt der ganzen Begegnung)", () => {
    const rows = calculatePlayerRanking({
      slots: [singles({ status: "CANCELLED" })],
    });
    expect(rows).toEqual([]);
  });

  it("zählt einen Einzel-Walkover mit dem erfassten Legstand (A4.4)", () => {
    const rows = calculatePlayerRanking({
      slots: [singles({ status: "WALKOVER", homeLegs: 2, awayLegs: 0 })],
    });
    const alice = rows.find((row) => row.playerId === ALICE);
    expect(alice).toMatchObject({ played: 1, won: 1, achievedPoints: 4 });
  });

  it("gibt einer ausgewechselten Person drei statt vier gewertete Einzel", () => {
    const rows = calculatePlayerRanking({
      slots: [
        singles({ encounterId: "e1", homePlayerIds: [ALICE] }),
        singles({ encounterId: "e1", homePlayerIds: [ALICE] }),
        singles({ encounterId: "e1", homePlayerIds: [ALICE] }),
        singles({ encounterId: "e1", homePlayerIds: [CARLA] }),
      ],
    });
    const alice = rows.find((row) => row.playerId === ALICE);
    const carla = rows.find((row) => row.playerId === CARLA);
    expect(alice?.played).toBe(3);
    expect(carla?.played).toBe(1);
  });

  it("ordnet eine Aushilfe der Mannschaft mit den meisten gewerteten Einzeln zu und zählt die andere", () => {
    const rows = calculatePlayerRanking({
      slots: [
        singles({ encounterId: "e1", matchday: 1, homeTeamId: TEAM_A, homePlayerIds: [ALICE] }),
        singles({ encounterId: "e1", matchday: 1, homeTeamId: TEAM_A, homePlayerIds: [ALICE] }),
        singles({ encounterId: "e2", matchday: 2, homeTeamId: TEAM_B, homePlayerIds: [ALICE], awayTeamId: TEAM_A }),
      ],
    });
    const alice = rows.find((row) => row.playerId === ALICE);
    expect(alice).toMatchObject({ teamId: TEAM_A, played: 3, otherTeamsCount: 1 });
  });

  it("ordnet nach Ranglistenpunkten (Kriterium 1)", () => {
    const rows = calculatePlayerRanking({
      slots: [
        singles({ homePlayerIds: [ALICE], homeLegs: 2, awayLegs: 0, awayPlayerIds: [BOB] }),
        singles({ homePlayerIds: [CARLA], homeLegs: 2, awayLegs: 1, awayPlayerIds: [BOB] }),
      ],
    });
    const ordered = rows.map((row) => row.playerId);
    expect(ordered.indexOf(ALICE)).toBeLessThan(ordered.indexOf(CARLA));
  });

  it("unterscheidet zwei Personen mit gleichem Q-Sp. schon über die Ranglistenpunkte (Kriterium 1 wertet die Siegmarge)", () => {
    // Beide je 1 Sieg aus 2 Einzeln (Q-Sp. gleich, 0.5), aber Carla mit der
    // überzeugenderen Siegmarge (2:0 statt 2:1) und damit höheren
    // Ranglistenpunkten — Kriterium 1 entscheidet hier bereits, ohne dass
    // Q-Sp. oder Q-Satz befragt werden müssen.
    const rows = calculatePlayerRanking({
      slots: [
        singles({ encounterId: "e1", homePlayerIds: [ALICE], homeLegs: 2, awayLegs: 1, awayPlayerIds: [BOB] }),
        singles({ encounterId: "e2", homePlayerIds: [ALICE], homeLegs: 0, awayLegs: 2, awayPlayerIds: [BOB] }),
        singles({ encounterId: "e3", homePlayerIds: [CARLA], homeLegs: 2, awayLegs: 0, awayPlayerIds: [BOB] }),
        singles({ encounterId: "e4", homePlayerIds: [CARLA], homeLegs: 0, awayLegs: 2, awayPlayerIds: [BOB] }),
      ],
    });
    const alice = rows.find((row) => row.playerId === ALICE);
    const carla = rows.find((row) => row.playerId === CARLA);
    // Alice: erzielte 3+0=3, möglich 8 -> Ranglistenpkt 3²/8 = 1.125.
    // Carla: erzielte 4+0=4, möglich 8 -> Ranglistenpkt 4²/8 = 2.0.
    expect((carla?.rank ?? 99)).toBeLessThan(alice?.rank ?? 0);
  });

  it("bricht einen echten Gleichstand der Ranglistenpunkte über Q-Sp. (Kriterium 2)", () => {
    // Beide kommen exakt auf Ranglistenpunkte 4 (erzielte² / mögliche =
    // 16/4 bzw. 64/16), aber mit unterschiedlichem Q-Sp.: Alice gewinnt ihr
    // einziges Einzel (Q-Sp. 1.0), Bob steht bei zwei Siegen aus vier
    // Einzeln (Q-Sp. 0.5) — von Hand nachgerechnet, keine Zufallszahlen.
    const rows = calculatePlayerRanking({
      slots: [
        singles({ encounterId: "e1", homePlayerIds: [ALICE], homeLegs: 2, awayLegs: 0, awayPlayerIds: [CARLA] }),
        singles({ encounterId: "e2", homePlayerIds: [BOB], homeLegs: 2, awayLegs: 0, awayPlayerIds: [CARLA] }),
        singles({ encounterId: "e3", homePlayerIds: [BOB], homeLegs: 2, awayLegs: 0, awayPlayerIds: [CARLA] }),
        singles({ encounterId: "e4", homePlayerIds: [BOB], homeLegs: 0, awayLegs: 2, awayPlayerIds: [CARLA] }),
        singles({ encounterId: "e5", homePlayerIds: [BOB], homeLegs: 0, awayLegs: 2, awayPlayerIds: [CARLA] }),
      ],
    });
    const alice = rows.find((row) => row.playerId === ALICE);
    const bob = rows.find((row) => row.playerId === BOB);
    // Alice: erzielte 4, möglich 4 -> Ranglistenpkt 16/4 = 4.0, Q-Sp. 1/1 = 1.0.
    // Bob: erzielte 4+4+0+0=8, möglich 16 -> Ranglistenpkt 64/16 = 4.0, Q-Sp. 2/4 = 0.5.
    expect(alice?.rankingPoints).toBeCloseTo(bob?.rankingPoints ?? -1, 6);
    expect((alice?.rank ?? 99)).toBeLessThan(bob?.rank ?? 0);
  });

  it("teilt gleiche Ranglistenpunkte, Q-Sp. und Q-Satz auf einen gemeinsamen Rang und überspringt den nächsten", () => {
    // Alice und Carla haben je exakt dasselbe Ergebnis (2:0 gegen Bob) und
    // damit identische Ranglistenpunkte, Q-Sp. und Q-Satz — ein echter
    // Gleichstand. Bob verliert beide Einzel und bleibt klar dahinter.
    const rows = calculatePlayerRanking({
      slots: [
        singles({ encounterId: "e1", homePlayerIds: [ALICE], homeLegs: 2, awayLegs: 0, awayPlayerIds: [BOB] }),
        singles({ encounterId: "e2", homePlayerIds: [CARLA], homeLegs: 2, awayLegs: 0, awayPlayerIds: [BOB] }),
      ],
    });
    const alice = rows.find((row) => row.playerId === ALICE);
    const carla = rows.find((row) => row.playerId === CARLA);
    expect(alice?.rank).toBe(carla?.rank);
    const bob = rows.find((row) => row.playerId === BOB);
    expect(bob?.rank).toBe(3);
  });
});
