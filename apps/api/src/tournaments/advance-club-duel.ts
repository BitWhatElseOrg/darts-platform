import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { auditEvents, outboxEvents, tournamentMatches, tournamentParticipants, tournamentStages, tournaments } from "@darts-platform/database";
import {
  CLUB_DUEL_STAGE_KEYS,
  calculateClubStandings,
  calculateCrossRoundStandings,
  pairClubSwissRound,
  plannedQualifyingMatch,
  type ClubSide,
} from "@darts-platform/tournament-engine";

import type { Principal } from "../auth/auth.types.js";
import { auditActor } from "../common/audit-actor.js";
import type { AuditContext } from "../common/audit-context.js";
import type { DatabaseService } from "../database/database.service.js";
import { qualifyingRoundLabel } from "./club-duel-labels.js";
import { loadCompletedMatchResults } from "./completed-match-results.js";

type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];
type MatchRow = typeof tournamentMatches.$inferSelect;
type ClubStandingRows = ReturnType<typeof calculateClubStandings>["sideA"];

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["COMPLETED", "BYE", "CANCELLED"]);

const sideRankReferenceSchema = z.object({
  type: z.literal("SIDE_RANK"),
  stageKey: z.string(),
  side: z.enum(["A", "B"]),
  rank: z.number().int().positive(),
});

export interface AdvanceClubDuelInput {
  readonly organizationId: string;
  readonly tournamentId: string;
  readonly now: Date;
  readonly actor: { readonly principal: Principal; readonly audit: AuditContext };
}

function isOpen(match: MatchRow): boolean {
  return !TERMINAL_STATUSES.has(match.status);
}

function toSide(value: string | null): ClubSide {
  if (value === "A" || value === "B") return value;
  throw new Error("Club duel participant without side.");
}

/**
 * Treibt ein Vereinsduell nach einem Matchabschluss weiter (Spec, API und
 * Ablauf; ADR 0021). Laeuft in der Transaktion des Abschlusses, direkt vor
 * `updateTournamentProgress`. Die Turnierzeile wird FOR UPDATE gesperrt,
 * BEVOR offene Spiele gezaehlt werden: Zwei parallel abgeschlossene letzte
 * Spiele einer Runde sehen so nacheinander denselben Stand, und nur das
 * zweite paart. Fuer andere Formate ein No-op.
 */
export async function advanceClubDuel(transaction: DatabaseTransaction, input: AdvanceClubDuelInput): Promise<void> {
  const [tournament] = await transaction.select().from(tournaments).where(and(
    eq(tournaments.organizationId, input.organizationId),
    eq(tournaments.id, input.tournamentId),
  )).for("update").limit(1);
  if (tournament === undefined || tournament.format !== "CLUB_DUEL") return;
  if (tournament.qualifyingRounds === null || tournament.finalRoundSize === null) {
    throw new Error("Club duel configuration invariant violated.");
  }

  const [stages, participantRows, matchRows] = await Promise.all([
    transaction.select().from(tournamentStages).where(and(eq(tournamentStages.organizationId, input.organizationId), eq(tournamentStages.tournamentId, input.tournamentId))),
    transaction.select().from(tournamentParticipants).where(and(eq(tournamentParticipants.organizationId, input.organizationId), eq(tournamentParticipants.tournamentId, input.tournamentId))).orderBy(asc(tournamentParticipants.seed)),
    transaction.select().from(tournamentMatches).where(and(eq(tournamentMatches.organizationId, input.organizationId), eq(tournamentMatches.tournamentId, input.tournamentId))).orderBy(asc(tournamentMatches.round), asc(tournamentMatches.position)),
  ]);
  const stageByKey = new Map(stages.map((stage) => [stage.key, stage]));
  const qualifying = stageByKey.get(CLUB_DUEL_STAGE_KEYS.qualifying);
  const finalRound = stageByKey.get(CLUB_DUEL_STAGE_KEYS.finalRound);
  const final = stageByKey.get(CLUB_DUEL_STAGE_KEYS.final);
  if (qualifying === undefined || finalRound === undefined || final === undefined) throw new Error("Club duel stage invariant violated.");

  const participants = participantRows.map((row) => ({ playerId: row.playerId, seed: row.seed, side: toSide(row.side) }));
  const withdrawnPlayerIds = participantRows.filter((row) => row.status === "WITHDRAWN").map((row) => row.playerId);
  const activeIds = new Set(participantRows.filter((row) => row.status === "ACTIVE").map((row) => row.playerId));
  const sideOf = new Map(participants.map((participant) => [participant.playerId, participant.side]));

  const qualifyingMatches = matchRows.filter((match) => match.stageId === qualifying.id);
  if (qualifyingMatches.some(isOpen)) return;
  const playedRounds = qualifyingMatches.reduce((max, match) => Math.max(max, match.round), 0);
  const qualifyingResults = await loadCompletedMatchResults(transaction, input.organizationId, qualifyingMatches);
  const standings = calculateClubStandings({ participants, results: qualifyingResults.results, withdrawnPlayerIds });

  if (playedRounds < tournament.qualifyingRounds) {
    await pairNextRound(transaction, input, { stageId: qualifying.id, round: playedRounds + 1, standings, qualifyingMatches, activeIds, sideOf });
    return;
  }

  // Quali fertig → Finalrunde besetzen (Spec: fehlende Plaetze → Walkover fuer den Gegner)
  const finalRoundMatches = matchRows.filter((match) => match.stageId === finalRound.id);
  if (finalRoundMatches.some((match) => match.status === "WAITING")) {
    const qualifiers = {
      A: standings.sideA.filter((row) => !row.withdrawn).slice(0, tournament.finalRoundSize).map((row) => row.playerId),
      B: standings.sideB.filter((row) => !row.withdrawn).slice(0, tournament.finalRoundSize).map((row) => row.playerId),
    };
    const ready = await resolveSideRanks(transaction, input, CLUB_DUEL_STAGE_KEYS.qualifying, qualifiers, finalRoundMatches);
    // Waren alle Plaetze unbesetzt oder kampflos, gibt es keinen offenen Abschluss mehr, der weitertreibt.
    if (ready === 0) await advanceClubDuel(transaction, input);
    return;
  }
  if (finalRoundMatches.some(isOpen)) return;

  // Finalrunde fertig → Final und Platz 3 besetzen
  const finalMatches = matchRows.filter((match) => match.stageId === final.id);
  if (!finalMatches.some((match) => match.status === "WAITING")) return;
  const crossResults = await loadCompletedMatchResults(transaction, input.organizationId, finalRoundMatches);
  // Die Finalisten stehen mit der Besetzung fest; ein Rueckzug waehrend der Finalrunde aendert sie nicht.
  const finalists = (side: ClubSide) => {
    const ids = new Set(finalRoundMatches.flatMap((match) => [match.participantOneId, match.participantTwoId]).filter((id): id is string => id !== null && sideOf.get(id) === side));
    return [...ids].map((playerId) => {
      const rank = (side === "A" ? standings.sideA : standings.sideB).find((row) => row.playerId === playerId)?.position;
      if (rank === undefined) throw new Error("Qualifier rank invariant violated.");
      return { playerId, qualifyingRank: rank };
    });
  };
  const cross = calculateCrossRoundStandings({
    sideA: finalists("A"),
    sideB: finalists("B"),
    results: crossResults.results,
    unopposedWalkoverWinnerIds: crossResults.unopposedWalkoverWinnerIds,
  });
  await resolveSideRanks(transaction, input, CLUB_DUEL_STAGE_KEYS.finalRound, {
    A: cross.sideA.map((row) => row.playerId),
    B: cross.sideB.map((row) => row.playerId),
  }, finalMatches);
}

async function pairNextRound(
  transaction: DatabaseTransaction,
  input: AdvanceClubDuelInput,
  context: {
    readonly stageId: string;
    readonly round: number;
    readonly standings: ReturnType<typeof calculateClubStandings>;
    readonly qualifyingMatches: readonly MatchRow[];
    readonly activeIds: ReadonlySet<string>;
    readonly sideOf: ReadonlyMap<string, ClubSide>;
  },
): Promise<void> {
  const ranked = (rows: ClubStandingRows) =>
    rows.filter((row) => context.activeIds.has(row.playerId)).map((row) => ({ playerId: row.playerId, seed: row.seed }));
  // Pausen: aktive Spieler ohne Spiel in einer bereits gepaarten Runde
  const pauses = new Map<string, number>();
  for (let round = 1; round < context.round; round += 1) {
    const inRound = new Set(context.qualifyingMatches.filter((match) => match.round === round).flatMap((match) => [match.participantOneId, match.participantTwoId]));
    for (const playerId of context.activeIds) {
      if (!inRound.has(playerId)) pauses.set(playerId, (pauses.get(playerId) ?? 0) + 1);
    }
  }
  const played = new Map(context.standings.overall.map((row) => [row.playerId, row.played]));
  const previousPairings = context.qualifyingMatches.flatMap((match) => {
    if (match.participantOneId === null || match.participantTwoId === null) return [];
    const [playerAId, playerBId] = context.sideOf.get(match.participantOneId) === "A"
      ? [match.participantOneId, match.participantTwoId]
      : [match.participantTwoId, match.participantOneId];
    return [{ playerAId, playerBId }];
  });
  const paired = pairClubSwissRound({
    round: context.round,
    sideA: ranked(context.standings.sideA),
    sideB: ranked(context.standings.sideB),
    previousPairings,
    pauses,
    played,
  });

  // Zweite Verteidigungslinie vor dem Schreiben (Spec, Datenmodell)
  const seen = new Set<string>();
  for (const pairing of paired.pairings) {
    if (context.sideOf.get(pairing.playerAId) !== "A" || context.sideOf.get(pairing.playerBId) !== "B") {
      throw new Error("Club duel pairing invariant violated: CLUB_DUEL_SAME_SIDE_PAIRING");
    }
    if (seen.has(pairing.playerAId) || seen.has(pairing.playerBId)) {
      throw new Error("Club duel pairing invariant violated: CLUB_DUEL_DUPLICATE_IN_ROUND");
    }
    seen.add(pairing.playerAId);
    seen.add(pairing.playerBId);
  }

  await transaction.insert(tournamentMatches).values(paired.pairings.map((pairing) => {
    const planned = plannedQualifyingMatch(context.round, pairing);
    return {
      organizationId: input.organizationId,
      tournamentId: input.tournamentId,
      stageId: context.stageId,
      groupId: null,
      key: planned.key,
      stageLabel: qualifyingRoundLabel(context.round),
      round: context.round,
      position: planned.position,
      status: "READY",
      participantOneId: pairing.playerAId,
      participantTwoId: pairing.playerBId,
      participantOneRef: planned.participantOne,
      participantTwoRef: planned.participantTwo,
    };
  }));
  const payload = {
    tournamentId: input.tournamentId,
    stageKey: CLUB_DUEL_STAGE_KEYS.qualifying,
    round: context.round,
    pairings: paired.pairings,
    pausedPlayerIds: paired.pausedPlayerIds,
    warnings: paired.warnings,
  };
  await transaction.insert(outboxEvents).values({
    organizationId: input.organizationId,
    aggregateType: "Tournament",
    aggregateId: input.tournamentId,
    eventType: "TOURNAMENT_ROUND_PAIRED",
    payload,
  });
  await transaction.insert(auditEvents).values({
    organizationId: input.organizationId,
    ...auditActor(input.actor.principal),
    action: "TOURNAMENT_ROUND_PAIRED",
    entityType: "Tournament",
    entityId: input.tournamentId,
    newValue: payload,
    ip: input.actor.audit.ip,
    userAgent: input.actor.audit.userAgent,
    correlationId: input.actor.audit.correlationId,
  });
}

/**
 * Setzt `SIDE_RANK`-Platzhalter einer Phase ein. Fehlt ein Rang (Seite hat
 * zu wenig aktive Spieler), gewinnt der Gegner kampflos; fehlen beide, ist
 * das Spiel abgesagt. Gibt die Zahl der spielbereiten Matches zurueck.
 */
async function resolveSideRanks(
  transaction: DatabaseTransaction,
  input: AdvanceClubDuelInput,
  stageKey: string,
  ranking: { readonly A: readonly string[]; readonly B: readonly string[] },
  matches: readonly MatchRow[],
): Promise<number> {
  let readyCount = 0;
  for (const match of matches) {
    if (match.status !== "WAITING") continue;
    const first = sideRankReferenceSchema.safeParse(match.participantOneRef);
    const second = sideRankReferenceSchema.safeParse(match.participantTwoRef);
    if (!first.success || !second.success || first.data.stageKey !== stageKey || second.data.stageKey !== stageKey) continue;
    const playerOneId = ranking[first.data.side][first.data.rank - 1] ?? null;
    const playerTwoId = ranking[second.data.side][second.data.rank - 1] ?? null;
    const status = playerOneId !== null && playerTwoId !== null ? "READY" : playerOneId === null && playerTwoId === null ? "CANCELLED" : "COMPLETED";
    if (status === "READY") readyCount += 1;
    await transaction.update(tournamentMatches).set({
      participantOneId: playerOneId,
      participantTwoId: playerTwoId,
      participantOneRef: playerOneId === null ? null : match.participantOneRef,
      participantTwoRef: playerTwoId === null ? null : match.participantTwoRef,
      status,
      resultType: status === "COMPLETED" ? "WALKOVER" : null,
      winnerPlayerId: status === "COMPLETED" ? (playerOneId ?? playerTwoId) : null,
      completedAt: status === "COMPLETED" ? input.now : null,
      version: match.version + 1,
      updatedAt: input.now,
    }).where(and(eq(tournamentMatches.organizationId, input.organizationId), eq(tournamentMatches.id, match.id)));
  }
  return readyCount;
}
