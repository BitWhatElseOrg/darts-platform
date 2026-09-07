import { describe, expect, it } from "vitest";
import { calculatePlayerStatistics, type StatisticsMatch } from "./statistics.js";

describe("Spielerstatistiken", () => {
  it("aggregiert Average, First 9, Checkout, 180, High Finish und Best Leg deterministisch", () => {
    const match: StatisticsMatch = {
      id: "m1", completedAt: new Date("2026-01-01T12:00:00Z"), winnerPlayerId: "a",
      outRule: "DOUBLE",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 }, { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 }],
      legs: [{ id: "l1", winnerPlayerId: "a" }],
      visits: [
        { legId: "l1", playerId: "a", appliedPoints: 180, dartsThrown: 3, checkoutAttempts: 0, outcome: "SCORED", reverted: false },
        { legId: "l1", playerId: "a", appliedPoints: 180, dartsThrown: 3, checkoutAttempts: 0, outcome: "SCORED", reverted: false },
        { legId: "l1", playerId: "a", appliedPoints: 101, dartsThrown: 3, checkoutAttempts: 2, outcome: "MATCH_WON", reverted: false },
      ],
    };
    const result = calculatePlayerStatistics("a", [match]);
    expect(result.career).toMatchObject({ matchesPlayed: 1, wins: 1, threeDartAverage: 153.67, firstNineAverage: 153.67, checkoutPercentage: 50, oneEighties: 2, highFinish: 101, bestLeg: 9, dartsPerLeg: 9 });
    expect(result.headToHead[0]).toMatchObject({ opponentPlayerId: "b", wins: 1 });
    expect(result.rankingHistory[0]?.rating).toBe(1512);
  });

  it("wertet historische Checkouts ohne erfasste Doppelversuche nicht als Quote", () => {
    const match: StatisticsMatch = {
      id: "legacy", completedAt: new Date("2025-01-01T12:00:00Z"), winnerPlayerId: "a",
      outRule: "DOUBLE",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 }, { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 }],
      legs: [{ id: "leg", winnerPlayerId: "a" }],
      visits: [{ legId: "leg", playerId: "a", appliedPoints: 40, dartsThrown: 1, checkoutAttempts: 0, outcome: "MATCH_WON", reverted: false }],
    };
    expect(calculatePlayerStatistics("a", [match]).career).toMatchObject({ checkoutAttempts: 0, checkouts: 0, checkoutPercentage: 0, highFinish: 40 });
  });

  it("weist die Checkout-Kennzahlen unter Single Out als nicht anwendbar aus", () => {
    // Reglement 1.1, Klasse C: 501 SO. Unter Straight Out gibt es keinen
    // Doppelversuch, den man zaehlen koennte -- die Quote ist nicht definiert.
    const match: StatisticsMatch = {
      id: "single-out", completedAt: new Date("2026-02-01T12:00:00Z"), winnerPlayerId: "a",
      outRule: "SINGLE",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 }, { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 }],
      legs: [{ id: "l1", winnerPlayerId: "a" }],
      visits: [
        { legId: "l1", playerId: "a", appliedPoints: 180, dartsThrown: 3, checkoutAttempts: 0, outcome: "SCORED", reverted: false },
        { legId: "l1", playerId: "a", appliedPoints: 321, dartsThrown: 3, checkoutAttempts: 0, outcome: "MATCH_WON", reverted: false },
      ],
    };
    const career = calculatePlayerStatistics("a", [match]).career;

    expect(career.checkoutPercentage).toBeNull();
    expect(career.checkoutAttempts).toBeNull();
    expect(career.checkouts).toBeNull();
    // Alles andere bleibt auswertbar.
    expect(career).toMatchObject({ matchesPlayed: 1, wins: 1, oneEighties: 1, highFinish: 321, bestLeg: 6 });
  });

  it("zaehlt nur Aufnahmen aus Matches mit Doppel- oder Master-Out in die Quote", () => {
    const singleOut: StatisticsMatch = {
      id: "single-out", completedAt: new Date("2026-02-01T12:00:00Z"), winnerPlayerId: "a",
      outRule: "SINGLE",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 }, { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 }],
      legs: [{ id: "l1", winnerPlayerId: "a" }],
      visits: [{ legId: "l1", playerId: "a", appliedPoints: 40, dartsThrown: 2, checkoutAttempts: 0, outcome: "MATCH_WON", reverted: false }],
    };
    const doubleOut: StatisticsMatch = {
      id: "double-out", completedAt: new Date("2026-02-02T12:00:00Z"), winnerPlayerId: "a",
      outRule: "DOUBLE",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 }, { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 }],
      legs: [{ id: "l2", winnerPlayerId: "a" }],
      visits: [{ legId: "l2", playerId: "a", appliedPoints: 40, dartsThrown: 2, checkoutAttempts: 2, outcome: "MATCH_WON", reverted: false }],
    };
    const career = calculatePlayerStatistics("a", [singleOut, doubleOut]).career;

    // Zwei Darts auf ein Finish, ein erfolgreiches Checkout -> 50 %.
    expect(career).toMatchObject({ checkoutAttempts: 2, checkouts: 1, checkoutPercentage: 50 });
  });

  it("weist die Checkout-Kennzahlen bei einem kampflos gewerteten Double-Out-Match als nicht anwendbar aus", () => {
    // PR-Agent-Finding auf #16 ("Incorrect Nullability"): massgeblich ist die
    // aktive Aufnahme dieser Person, nicht das Match. Ein Walkover hat gar
    // keine Aufnahmen dieser Person, obwohl das Match unter Double Out laeuft.
    const walkover: StatisticsMatch = {
      id: "walkover", completedAt: new Date("2026-02-03T12:00:00Z"), winnerPlayerId: "a",
      outRule: "DOUBLE",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 0, setsWon: 0 }, { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 }],
      legs: [],
      visits: [],
    };
    const career = calculatePlayerStatistics("a", [walkover]).career;

    expect(career.checkoutPercentage).toBeNull();
    expect(career.checkoutAttempts).toBeNull();
    expect(career.checkouts).toBeNull();
  });

  it("weist die Checkout-Kennzahlen als nicht anwendbar aus, wenn alle Aufnahmen unter Double Out zurueckgenommen wurden", () => {
    // Dieselbe Begruendung wie beim Walkover: ohne aktive Aufnahme dieser
    // Person zaehlt das Match nicht, auch wenn urspruenglich geworfen wurde.
    const revertedOnly: StatisticsMatch = {
      id: "reverted-only", completedAt: new Date("2026-02-04T12:00:00Z"), winnerPlayerId: "b",
      outRule: "DOUBLE",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 0, setsWon: 0 }, { playerId: "b", displayName: "Beat", legsWon: 1, setsWon: 1 }],
      legs: [{ id: "l1", winnerPlayerId: "b" }],
      visits: [
        { legId: "l1", playerId: "a", appliedPoints: 40, dartsThrown: 2, checkoutAttempts: 2, outcome: "MATCH_WON", reverted: true },
      ],
    };
    const career = calculatePlayerStatistics("a", [revertedOnly]).career;

    expect(career.checkoutPercentage).toBeNull();
    expect(career.checkoutAttempts).toBeNull();
    expect(career.checkouts).toBeNull();
  });

  it("rechnet den Rankingverlauf gegen die Bewertung des tatsaechlichen Gegners", () => {
    const between = (id: string, completedAt: string, winnerPlayerId: string): StatisticsMatch => ({
      id, completedAt: new Date(completedAt), winnerPlayerId, outRule: "DOUBLE",
      participants: [
        { playerId: "a", displayName: "Anna", legsWon: winnerPlayerId === "a" ? 1 : 0, setsWon: winnerPlayerId === "a" ? 1 : 0 },
        { playerId: "b", displayName: "Beat", legsWon: winnerPlayerId === "b" ? 1 : 0, setsWon: winnerPlayerId === "b" ? 1 : 0 },
      ],
      legs: [],
      visits: [],
    });
    const history = calculatePlayerStatistics("a", [
      between("m1", "2026-03-01T20:00:00Z", "a"),
      between("m2", "2026-03-08T20:00:00Z", "a"),
      between("m3", "2026-03-15T20:00:00Z", "b"),
    ]).rankingHistory;

    // Von Hand gerechnet, K = 24, Start 1500: nach zwei Siegen gegen eine
    // schwaecher gewordene Gegnerin bringt der zweite Sieg weniger als der
    // erste (11 statt 12 Punkte), die Niederlage danach kostet 14.
    expect(history.map((entry) => entry.rating)).toEqual([1512, 1523, 1509]);
    expect(history.map((entry) => entry.matchId)).toEqual(["m1", "m2", "m3"]);
  });

  it("ordnet gleichzeitig beendete Matches deterministisch nach ihrer Id", () => {
    const sameMoment = (id: string, winnerPlayerId: string): StatisticsMatch => ({
      id, completedAt: new Date("2026-04-01T20:00:00Z"), winnerPlayerId, outRule: "DOUBLE",
      participants: [
        { playerId: "a", displayName: "Anna", legsWon: 0, setsWon: 0 },
        { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 },
      ],
      legs: [],
      visits: [],
    });
    const forwards = calculatePlayerStatistics("a", [sameMoment("m-b", "b"), sameMoment("m-a", "a")]).rankingHistory;
    const backwards = calculatePlayerStatistics("a", [sameMoment("m-a", "a"), sameMoment("m-b", "b")]).rankingHistory;

    expect(forwards).toEqual(backwards);
    expect(forwards.map((entry) => entry.matchId)).toEqual(["m-a", "m-b"]);
  });

  it("sortiert den direkten Vergleich nach Anzeigename, nicht nach der Spieler-Id", () => {
    const against = (id: string, opponentId: string, opponentName: string): StatisticsMatch => ({
      id, completedAt: new Date(`2026-05-0${id.slice(-1)}T20:00:00Z`), winnerPlayerId: "a", outRule: "DOUBLE",
      participants: [
        { playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 },
        { playerId: opponentId, displayName: opponentName, legsWon: 0, setsWon: 0 },
      ],
      legs: [],
      visits: [],
    });
    // Ids widersprechen bewusst der alphabetischen Namensreihenfolge: "Anna"
    // traegt die zuletzt sortierende Id ("z..."), "Zora" die zuerst
    // sortierende ("a..."). Ein Test, der nach Id sortierte, liefert damit
    // die falsche Reihenfolge und faellt durch.
    const headToHead = calculatePlayerStatistics("a", [
      against("m1", "z-anna", "Anna"),
      against("m2", "m-beat", "Beat"),
      against("m3", "a-zora", "Zora"),
    ]).headToHead;

    // Gleiche Zahl Begegnungen -> Reihenfolge nach Anzeigename (Code-Units),
    // nicht nach einer ICU-Kollation, die je nach Laufzeit anders sortiert,
    // und nicht nach der Spieler-Id.
    expect(headToHead.map((entry) => entry.opponentDisplayName)).toEqual(["Anna", "Beat", "Zora"]);
    expect(headToHead.map((entry) => entry.opponentPlayerId)).toEqual(["z-anna", "m-beat", "a-zora"]);
  });

  it("loest den direkten Vergleich bei gleichem Anzeigenamen ueber die Spieler-Id auf", () => {
    const against = (id: string, opponentId: string): StatisticsMatch => ({
      id, completedAt: new Date(`2026-05-0${id.slice(-1)}T20:00:00Z`), winnerPlayerId: "a", outRule: "DOUBLE",
      participants: [
        { playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 },
        { playerId: opponentId, displayName: "Beat", legsWon: 0, setsWon: 0 },
      ],
      legs: [],
      visits: [],
    });
    const headToHead = calculatePlayerStatistics("a", [
      against("m1", "beat-2"),
      against("m2", "beat-1"),
    ]).headToHead;

    expect(headToHead.map((entry) => entry.opponentPlayerId)).toEqual(["beat-1", "beat-2"]);
  });
});
