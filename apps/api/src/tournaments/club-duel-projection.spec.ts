import { describe, expect, it } from "vitest";

import { clubDuelDashboardSchema, type ClubDuelDashboard } from "@darts-platform/schemas";

import type { LegsOf } from "./completed-match-results.js";
import { projectClubDuel } from "./club-duel-projection.js";
import type { TournamentDashboardData } from "./tournaments.repository.js";

type TournamentRow = TournamentDashboardData["tournament"];
type StageRow = TournamentDashboardData["stages"][number];
type MatchRow = TournamentDashboardData["matches"][number];
type ParticipantRow = TournamentDashboardData["participants"][number];

const organizationId = "00000000-0000-4000-8000-000000000001";
const tournamentId = "00000000-0000-4000-8000-000000000002";
const boardId = "00000000-0000-4000-8000-000000000003";
const stageIds = {
  qualifying: "00000000-0000-4000-8000-0000000000a1",
  finalRound: "00000000-0000-4000-8000-0000000000a2",
  final: "00000000-0000-4000-8000-0000000000a3",
} as const;
const players = {
  a1: "00000000-0000-4000-8000-0000000000b1",
  a2: "00000000-0000-4000-8000-0000000000b2",
  b1: "00000000-0000-4000-8000-0000000000c1",
  b2: "00000000-0000-4000-8000-0000000000c2",
} as const;
const createdAt = new Date("2026-10-10T18:00:00.000Z");

function tournament(overrides: Partial<TournamentRow> = {}): TournamentRow {
  return {
    id: tournamentId,
    organizationId,
    publicId: "00000000-0000-4000-8000-000000000004",
    visibility: "PRIVATE",
    name: "Vereinsduell Test",
    status: "GROUP_STAGE",
    format: "CLUB_DUEL",
    version: 3,
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    maxRounds: null,
    bestOfLegs: 1,
    legsToWinSet: 1,
    setsToWin: 1,
    groupCount: 0,
    qualifyPerGroup: 0,
    knockoutSize: 0,
    seeding: "MANUAL",
    sideAName: "VFC",
    sideBName: "DC Musterdorf",
    qualifyingRounds: 1,
    finalRoundSize: 2,
    thirdPlaceMatch: true,
    startsAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function stage(id: string, key: string, sequence: number, type: string): StageRow {
  return { id, organizationId, tournamentId, key, sequence, name: key, type, status: "OPEN", createdAt, updatedAt: createdAt };
}

function match(overrides: Partial<MatchRow> & Pick<MatchRow, "id" | "stageId" | "position">): MatchRow {
  return {
    organizationId,
    tournamentId,
    groupId: null,
    key: `match:${overrides.id}`,
    stageLabel: "Quali · Runde 1",
    round: 1,
    status: "READY",
    participantOneId: null,
    participantTwoId: null,
    participantOneRef: null,
    participantTwoRef: null,
    sourceOneMatchId: null,
    sourceTwoMatchId: null,
    sourceOneKind: null,
    sourceTwoKind: null,
    boardId: null,
    scoringMatchId: null,
    winnerPlayerId: null,
    resultType: null,
    version: 0,
    completedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function participant(playerId: string, seed: number, side: "A" | "B"): ParticipantRow {
  return {
    id: `00000000-0000-4000-8000-00000000d${seed.toString().padStart(3, "0")}`,
    playerId,
    displayName: `Spieler ${seed}`,
    seed,
    status: "ACTIVE",
    withdrawnAt: null,
    withdrawalReason: null,
    side,
  };
}

function dashboardData(input: { readonly matches: readonly MatchRow[]; readonly tournament?: TournamentRow }): TournamentDashboardData {
  return {
    tournament: input.tournament ?? tournament(),
    participants: [participant(players.a1, 1, "A"), participant(players.a2, 2, "A"), participant(players.b1, 3, "B"), participant(players.b2, 4, "B")],
    stages: [
      stage(stageIds.qualifying, "qualifying", 1, "CLUB_SWISS"),
      stage(stageIds.finalRound, "final-round", 2, "CLUB_CROSS_ROUND_ROBIN"),
      stage(stageIds.final, "final", 3, "SINGLE_ELIMINATION"),
    ],
    boards: [{ boardId, boardName: "Scheibe Nord", boardStatus: "AVAILABLE", ringNumber: 1 }],
    groups: [],
    groupParticipants: [],
    matches: input.matches,
    occupiedBoardIds: new Set(),
    activePlayerIds: new Set(),
  };
}

/** Projektion samt Laufzeit-Schemapruefung, wie sie das Dashboard ausliefert. */
function project(data: TournamentDashboardData, legsOf: LegsOf): ClubDuelDashboard {
  const projection = projectClubDuel({ data, legsOf });
  if (projection === null) throw new Error("projection missing");
  return clubDuelDashboardSchema.parse(projection);
}

const noLegs: LegsOf = () => undefined;

/** Legs je Scoring-Match und Person; alles andere unbekannt. */
function legsFrom(entries: Readonly<Record<string, Readonly<Record<string, number>>>>): LegsOf {
  return (scoringMatchId, playerId) => entries[scoringMatchId]?.[playerId];
}

describe("projectClubDuel", () => {
  it("liefert null fuer andere Formate", () => {
    const data = dashboardData({ matches: [], tournament: tournament({ format: "ROUND_ROBIN", sideAName: null, sideBName: null, qualifyingRounds: null, finalRoundSize: null }) });
    expect(projectClubDuel({ data, legsOf: noLegs })).toBeNull();
  });

  it("wertet ein gespieltes Match ohne bekannte Legs nicht und wirft nicht", () => {
    const completed = match({
      id: "00000000-0000-4000-8000-0000000000e1",
      stageId: stageIds.qualifying,
      position: 1,
      status: "COMPLETED",
      participantOneId: players.a1,
      participantTwoId: players.b1,
      winnerPlayerId: players.a1,
      resultType: "PLAYED",
      scoringMatchId: "00000000-0000-4000-8000-0000000000f1",
      completedAt: createdAt,
    });
    const projection = project(dashboardData({ matches: [completed] }), noLegs);
    expect(projection.score).toEqual({ pointsA: 0, pointsB: 0, legDifferenceA: 0, leader: "TIED" });
    const [view] = projection.rounds[0]?.matches ?? [];
    expect(view?.status).toBe("COMPLETED");
    expect(view?.legs).toBeNull();
    expect(projection.standings.overall.every((row) => row.played === 0)).toBe(true);
  });

  it("wertet ein Match mit gleich vielen Legs fuer den gespeicherten Sieger und loest die Scheibe auf", () => {
    const scoringMatchId = "00000000-0000-4000-8000-0000000000f2";
    const completed = match({
      id: "00000000-0000-4000-8000-0000000000e2",
      stageId: stageIds.qualifying,
      position: 1,
      status: "COMPLETED",
      // Seite B auf Sitz 1: die Projektion richtet nach A/B aus.
      participantOneId: players.b2,
      participantTwoId: players.a2,
      winnerPlayerId: players.b2,
      resultType: "PLAYED",
      scoringMatchId,
      boardId,
      completedAt: createdAt,
    });
    const open = match({ id: "00000000-0000-4000-8000-0000000000e3", stageId: stageIds.qualifying, position: 2, participantOneId: players.a1, participantTwoId: players.b1 });
    const projection = project(dashboardData({ matches: [completed, open] }), legsFrom({ [scoringMatchId]: { [players.b2]: 4, [players.a2]: 4 } }));
    expect(projection.score).toEqual({ pointsA: 0, pointsB: 1, legDifferenceA: 0, leader: "B" });
    const views = projection.rounds[0]?.matches ?? [];
    const playedView = views.find((view) => view.matchId === completed.id);
    expect(playedView).toMatchObject({ playerAId: players.a2, playerBId: players.b2, winnerPlayerId: players.b2, legs: [4, 4], resultType: "PLAYED", boardName: "Scheibe Nord" });
    expect(views.find((view) => view.matchId === open.id)?.boardName).toBeNull();
    const winnerRow = projection.standings.sideB.find((row) => row.playerId === players.b2);
    expect(winnerRow).toMatchObject({ played: 1, won: 1 });
  });
});
