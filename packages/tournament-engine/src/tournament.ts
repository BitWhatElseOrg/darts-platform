export class TournamentValidationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TournamentValidationError";
  }
}

export interface EngineParticipant {
  readonly playerId: string;
  readonly seed: number;
}

export interface RoundRobinPairing {
  readonly round: number;
  readonly position: number;
  readonly playerOneId: string;
  readonly playerTwoId: string;
}

export interface EngineGroup {
  readonly key: string;
  readonly label: string;
  readonly sequence: number;
  readonly participants: readonly EngineParticipant[];
}

export interface GroupAllocationInput {
  readonly participants: readonly EngineParticipant[];
  readonly groupCount: number;
  readonly seeding: "SEEDED" | "RANDOM";
  readonly randomSeed?: number;
}

export type KnockoutParticipantReference =
  | { readonly type: "PLAYER"; readonly playerId: string }
  | { readonly type: "GROUP_RANK"; readonly groupKey: string; readonly rank: number }
  | { readonly type: "MATCH_WINNER"; readonly matchKey: string };

export interface PlannedMatch {
  readonly key: string;
  readonly stageKey: string;
  readonly stageType: "GROUP" | "ROUND_ROBIN" | "SINGLE_ELIMINATION";
  readonly groupKey: string | null;
  readonly round: number;
  readonly position: number;
  readonly participantOne: KnockoutParticipantReference | null;
  readonly participantTwo: KnockoutParticipantReference | null;
  readonly state: "READY" | "WAITING" | "BYE";
  readonly byeWinnerPlayerId: string | null;
}

export interface TournamentPlanInput {
  readonly format: "GROUPS_THEN_KNOCKOUT" | "ROUND_ROBIN" | "SINGLE_ELIMINATION";
  readonly participants: readonly EngineParticipant[];
  readonly groupCount: number;
  readonly qualifyPerGroup: number;
  readonly knockoutSize: 2 | 4 | 8 | 16 | 32 | 64;
  readonly seeding: "SEEDED" | "RANDOM";
  readonly randomSeed?: number;
}

export interface TournamentPlan {
  readonly groups: readonly EngineGroup[];
  readonly matches: readonly PlannedMatch[];
}

export interface TournamentStructurePreview {
  readonly groups: readonly { readonly label: string; readonly participantCount: number }[];
  readonly groupMatchCount: number;
  readonly knockoutSize: number;
  readonly knockoutMatchCount: number;
  readonly byes: number;
  readonly totalMatches: number;
  readonly warnings: readonly string[];
}

export interface TournamentLifecycleStage {
  readonly id: string;
  readonly type: "GROUP" | "ROUND_ROBIN" | "SINGLE_ELIMINATION";
  readonly hasOpenMatches: boolean;
}

export interface TournamentLifecycle {
  readonly tournamentStatus: "GROUP_STAGE" | "KNOCKOUT" | "COMPLETED";
  readonly stages: readonly {
    readonly id: string;
    readonly status: "OPEN" | "WAITING" | "COMPLETED";
  }[];
}

export function calculateTournamentLifecycle(input: {
  readonly format: "GROUPS_THEN_KNOCKOUT" | "ROUND_ROBIN" | "SINGLE_ELIMINATION";
  readonly stages: readonly TournamentLifecycleStage[];
}): TournamentLifecycle {
  const hasOpenMatches = input.stages.some((stage) => stage.hasOpenMatches);
  const groupsHaveOpenMatches = input.stages.some(
    (stage) => stage.type === "GROUP" && stage.hasOpenMatches,
  );
  const tournamentStatus = !hasOpenMatches
    ? "COMPLETED"
    : input.format === "SINGLE_ELIMINATION" ||
        (input.format === "GROUPS_THEN_KNOCKOUT" && !groupsHaveOpenMatches)
      ? "KNOCKOUT"
      : "GROUP_STAGE";

  return {
    tournamentStatus,
    stages: input.stages.map((stage) => ({
      id: stage.id,
      status: !stage.hasOpenMatches
        ? "COMPLETED"
        : input.format === "GROUPS_THEN_KNOCKOUT" &&
            stage.type === "SINGLE_ELIMINATION" &&
            groupsHaveOpenMatches
          ? "WAITING"
          : "OPEN",
    })),
  };
}

export type GroupMatchResult =
  | {
      readonly type: "PLAYED";
      readonly playerOneId: string;
      readonly playerTwoId: string;
      readonly playerOneLegs: number;
      readonly playerTwoLegs: number;
      readonly winnerPlayerId: string;
    }
  | {
      readonly type: "WALKOVER";
      readonly playerOneId: string;
      readonly playerTwoId: string;
      readonly playerOneLegs: 0;
      readonly playerTwoLegs: 0;
      readonly winnerPlayerId: string;
    };

export interface GroupStanding {
  readonly position: number;
  readonly playerId: string;
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly legsFor: number;
  readonly legsAgainst: number;
  readonly legDifference: number;
  readonly points: number;
  readonly withdrawn: boolean;
}

export interface WithdrawalMatchSnapshot {
  readonly id: string;
  readonly status: "WAITING" | "READY" | "IN_PROGRESS" | "COMPLETED" | "BYE" | "CANCELLED";
  readonly participantOneId: string | null;
  readonly participantTwoId: string | null;
  readonly sourceOneMatchId: string | null;
  readonly sourceTwoMatchId: string | null;
  readonly winnerPlayerId: string | null;
  readonly participantOneResolved?: boolean;
  readonly participantTwoResolved?: boolean;
}

export interface WithdrawalMatchDecision {
  readonly matchId: string;
  readonly status: "WAITING" | "READY" | "COMPLETED" | "BYE" | "CANCELLED";
  readonly participantOneId: string | null;
  readonly participantTwoId: string | null;
  readonly winnerPlayerId: string | null;
  readonly resultType: "WALKOVER" | "BYE" | null;
}

function assertUniqueParticipants(participants: readonly EngineParticipant[]): void {
  if (participants.length < 2) {
    throw new TournamentValidationError(
      "NOT_ENOUGH_PARTICIPANTS",
      "A tournament needs at least two participants.",
    );
  }
  if (new Set(participants.map((participant) => participant.playerId)).size !== participants.length) {
    throw new TournamentValidationError(
      "DUPLICATE_PARTICIPANT",
      "A participant may only appear once.",
    );
  }
  if (new Set(participants.map((participant) => participant.seed)).size !== participants.length) {
    throw new TournamentValidationError("DUPLICATE_SEED", "Every seed must be unique.");
  }
}

function groupLabel(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function shuffled<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  let state = seed >>> 0;
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(next() * (index + 1));
    const current = result[index];
    const replacement = result[target];
    if (current === undefined || replacement === undefined) {
      throw new Error("Shuffle index invariant violated.");
    }
    result[index] = replacement;
    result[target] = current;
  }
  return result;
}

export function allocateGroups(input: GroupAllocationInput): readonly EngineGroup[] {
  assertUniqueParticipants(input.participants);
  if (!Number.isInteger(input.groupCount) || input.groupCount < 1) {
    throw new TournamentValidationError("INVALID_GROUP_COUNT", "Group count must be positive.");
  }
  if (input.participants.length < input.groupCount * 2) {
    throw new TournamentValidationError(
      "GROUP_TOO_SMALL",
      "Every group needs at least two participants.",
    );
  }

  const ordered =
    input.seeding === "SEEDED"
      ? [...input.participants].sort((left, right) => left.seed - right.seed)
      : shuffled(input.participants, input.randomSeed ?? 1);
  const buckets: EngineParticipant[][] = Array.from(
    { length: input.groupCount },
    () => [],
  );

  ordered.forEach((participant, index) => {
    const row = Math.floor(index / input.groupCount);
    const offset = index % input.groupCount;
    const groupIndex = row % 2 === 0 ? offset : input.groupCount - 1 - offset;
    const bucket = buckets[groupIndex];
    if (bucket === undefined) throw new Error("Group allocation invariant violated.");
    bucket.push(participant);
  });

  return buckets.map((participants, index) => {
    const label = groupLabel(index);
    return { key: `group-${label}`, label, sequence: index + 1, participants };
  });
}

export function previewTournamentStructure(input: {
  readonly format?: "GROUPS_THEN_KNOCKOUT" | "ROUND_ROBIN" | "SINGLE_ELIMINATION";
  readonly participantCount: number;
  readonly groupCount: number;
  readonly qualifyPerGroup: number;
  readonly knockoutSize: number;
}): TournamentStructurePreview {
  if (
    !Number.isInteger(input.participantCount) ||
    !Number.isInteger(input.groupCount) ||
    !Number.isInteger(input.qualifyPerGroup) ||
    !Number.isInteger(input.knockoutSize) ||
    input.participantCount < 2 ||
    input.groupCount < 1 ||
    input.qualifyPerGroup < 1 ||
    !isPowerOfTwo(input.knockoutSize)
  ) {
    throw new TournamentValidationError("INVALID_STRUCTURE", "Tournament structure is invalid.");
  }
  if (input.format === "ROUND_ROBIN") {
    const matchCount = (input.participantCount * (input.participantCount - 1)) / 2;
    return {
      groups: [{ label: "Alle", participantCount: input.participantCount }],
      groupMatchCount: matchCount,
      knockoutSize: 0,
      knockoutMatchCount: 0,
      byes: 0,
      totalMatches: matchCount,
      warnings: [],
    };
  }
  if (input.format === "SINGLE_ELIMINATION") {
    const warnings: string[] = [];
    if (input.participantCount > input.knockoutSize) {
      warnings.push("Das K.-o.-Tableau bietet nicht genug Plätze für alle Teilnehmer.");
    }
    if (input.participantCount < input.knockoutSize / 2) {
      warnings.push("Das K.-o.-Tableau würde ein vollständig leeres Erstrundenmatch enthalten.");
    }
    return {
      groups: [],
      groupMatchCount: 0,
      knockoutSize: input.knockoutSize,
      knockoutMatchCount: input.knockoutSize - 1,
      byes: Math.max(input.knockoutSize - input.participantCount, 0),
      totalMatches: input.knockoutSize - 1,
      warnings,
    };
  }
  const base = Math.floor(input.participantCount / input.groupCount);
  const remainder = input.participantCount % input.groupCount;
  const groups = Array.from({ length: input.groupCount }, (_, index) => ({
    label: groupLabel(index),
    participantCount: base + (index < remainder ? 1 : 0),
  }));
  const groupMatchCount = groups.reduce(
    (total, group) => total + (group.participantCount * (group.participantCount - 1)) / 2,
    0,
  );
  const qualifiers = input.groupCount * input.qualifyPerGroup;
  const warnings: string[] = [];
  if (base < 2) warnings.push("Jede Gruppe braucht mindestens zwei Teilnehmer.");
  if (input.qualifyPerGroup > base) {
    warnings.push("Eine Gruppe kann nicht mehr Teilnehmer qualifizieren als sie enthält.");
  }
  if (qualifiers !== input.knockoutSize) {
    warnings.push(
      "Die Grösse des K.-o.-Tableaus muss der Anzahl Qualifizierter entsprechen.",
    );
  }
  if (remainder !== 0) {
    warnings.push(
      `${input.participantCount} Teilnehmer werden auf unterschiedlich grosse Gruppen verteilt.`,
    );
  }
  const knockoutMatchCount = Math.max(input.knockoutSize - 1, 0);
  return {
    groups,
    groupMatchCount,
    knockoutSize: input.knockoutSize,
    knockoutMatchCount,
    byes: Math.max(input.knockoutSize - qualifiers, 0),
    totalMatches: groupMatchCount + knockoutMatchCount,
    warnings,
  };
}

export function generateRoundRobin(playerIds: readonly string[]): readonly RoundRobinPairing[] {
  if (playerIds.length < 2) {
    throw new TournamentValidationError(
      "NOT_ENOUGH_PARTICIPANTS",
      "Round robin needs at least two participants.",
    );
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new TournamentValidationError(
      "DUPLICATE_PARTICIPANT",
      "A participant may only appear once.",
    );
  }

  const rotation: (string | null)[] = [...playerIds];
  if (rotation.length % 2 === 1) rotation.push(null);
  const pairings: RoundRobinPairing[] = [];
  const rounds = rotation.length - 1;

  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    let position = 1;
    for (let index = 0; index < rotation.length / 2; index += 1) {
      const left = rotation[index];
      const right = rotation[rotation.length - 1 - index];
      if (left !== undefined && left !== null && right !== undefined && right !== null) {
        pairings.push({
          round: roundIndex + 1,
          position,
          playerOneId: roundIndex % 2 === 0 ? left : right,
          playerTwoId: roundIndex % 2 === 0 ? right : left,
        });
        position += 1;
      }
    }
    const last = rotation.pop();
    if (last === undefined) throw new Error("Round-robin rotation invariant violated.");
    rotation.splice(1, 0, last);
  }
  return pairings;
}

function isPowerOfTwo(value: number): boolean {
  return value >= 2 && (value & (value - 1)) === 0;
}

function seedOrder(size: number): readonly number[] {
  let order = [1, 2];
  for (let currentSize = 4; currentSize <= size; currentSize *= 2) {
    order = order.flatMap((seed) => [seed, currentSize + 1 - seed]);
  }
  return order;
}

export function generateKnockoutBracket(input: {
  readonly stageKey: string;
  readonly participants: readonly KnockoutParticipantReference[];
  readonly bracketSize: 2 | 4 | 8 | 16 | 32 | 64;
}): readonly PlannedMatch[] {
  if (!isPowerOfTwo(input.bracketSize) || input.bracketSize > 64) {
    throw new TournamentValidationError(
      "INVALID_BRACKET_SIZE",
      "Bracket size must be a power of two between 2 and 64.",
    );
  }
  if (input.participants.length < 2 || input.participants.length > input.bracketSize) {
    throw new TournamentValidationError(
      "BRACKET_CAPACITY",
      "The bracket must fit at least two and at most its configured participants.",
    );
  }
  if (input.participants.length < input.bracketSize / 2) {
    throw new TournamentValidationError(
      "EXCESSIVE_BYES",
      "The bracket may not contain an entirely empty first-round match.",
    );
  }
  const playerIds = input.participants.flatMap((participant) =>
    participant.type === "PLAYER" ? [participant.playerId] : [],
  );
  if (new Set(playerIds).size !== playerIds.length) {
    throw new TournamentValidationError(
      "DUPLICATE_PARTICIPANT",
      "A participant may only appear once in a bracket.",
    );
  }

  const slots = seedOrder(input.bracketSize).map(
    (seed) => input.participants[seed - 1] ?? null,
  );
  const matches: PlannedMatch[] = [];
  const firstRoundKeys: string[] = [];
  for (let index = 0; index < slots.length; index += 2) {
    const participantOne = slots[index] ?? null;
    const participantTwo = slots[index + 1] ?? null;
    const position = index / 2 + 1;
    const key = `${input.stageKey}:r1:m${position}`;
    firstRoundKeys.push(key);
    const readyParticipants = [participantOne, participantTwo].filter(
      (participant): participant is KnockoutParticipantReference => participant !== null,
    );
    const byeWinner =
      readyParticipants.length === 1 && readyParticipants[0]?.type === "PLAYER"
        ? readyParticipants[0].playerId
        : null;
    matches.push({
      key,
      stageKey: input.stageKey,
      stageType: "SINGLE_ELIMINATION",
      groupKey: null,
      round: 1,
      position,
      participantOne,
      participantTwo,
      state:
        readyParticipants.length === 1
          ? "BYE"
          : readyParticipants.every((participant) => participant.type === "PLAYER")
            ? "READY"
            : "WAITING",
      byeWinnerPlayerId: byeWinner,
    });
  }

  let previousKeys = firstRoundKeys;
  let round = 2;
  while (previousKeys.length > 1) {
    const nextKeys: string[] = [];
    for (let index = 0; index < previousKeys.length; index += 2) {
      const firstSource = previousKeys[index];
      const secondSource = previousKeys[index + 1];
      if (firstSource === undefined || secondSource === undefined) {
        throw new Error("Knockout dependency invariant violated.");
      }
      const position = index / 2 + 1;
      const key = `${input.stageKey}:r${round}:m${position}`;
      nextKeys.push(key);
      matches.push({
        key,
        stageKey: input.stageKey,
        stageType: "SINGLE_ELIMINATION",
        groupKey: null,
        round,
        position,
        participantOne: { type: "MATCH_WINNER", matchKey: firstSource },
        participantTwo: { type: "MATCH_WINNER", matchKey: secondSource },
        state: "WAITING",
        byeWinnerPlayerId: null,
      });
    }
    previousKeys = nextKeys;
    round += 1;
  }
  return matches;
}

export function calculateGroupStandings(input: {
  readonly participants: readonly EngineParticipant[];
  readonly results: readonly GroupMatchResult[];
  readonly withdrawnPlayerIds?: readonly string[];
}): readonly GroupStanding[] {
  assertUniqueParticipants(input.participants);
  const rows = new Map(
    input.participants.map((participant) => [
      participant.playerId,
      {
        playerId: participant.playerId,
        seed: participant.seed,
        played: 0,
        won: 0,
        lost: 0,
        legsFor: 0,
        legsAgainst: 0,
        points: 0,
      },
    ]),
  );
  const pairings = new Set<string>();
  for (const result of input.results) {
    const first = rows.get(result.playerOneId);
    const second = rows.get(result.playerTwoId);
    if (first === undefined || second === undefined || result.playerOneId === result.playerTwoId) {
      throw new TournamentValidationError(
        "INVALID_GROUP_RESULT",
        "A result references an invalid group participant.",
      );
    }
    const validWinner = [result.playerOneId, result.playerTwoId].includes(result.winnerPlayerId);
    const validScore = result.type === "WALKOVER"
      ? result.playerOneLegs === 0 && result.playerTwoLegs === 0
      : result.playerOneLegs >= 0 && result.playerTwoLegs >= 0 && result.playerOneLegs !== result.playerTwoLegs;
    if (!validScore || !validWinner) {
      throw new TournamentValidationError("INVALID_GROUP_RESULT", "A group result is invalid.");
    }
    const pairingKey = [result.playerOneId, result.playerTwoId].sort().join(":");
    if (pairings.has(pairingKey)) {
      throw new TournamentValidationError(
        "DUPLICATE_GROUP_RESULT",
        "A group pairing may only be recorded once.",
      );
    }
    pairings.add(pairingKey);
    first.played += 1;
    second.played += 1;
    first.legsFor += result.playerOneLegs;
    first.legsAgainst += result.playerTwoLegs;
    second.legsFor += result.playerTwoLegs;
    second.legsAgainst += result.playerOneLegs;
    const winner = result.winnerPlayerId === first.playerId ? first : second;
    const loser = winner === first ? second : first;
    winner.won += 1;
    winner.points += 2;
    loser.lost += 1;
  }
  return [...rows.values()]
    .sort(
      (left, right) =>
        right.points - left.points ||
        right.legsFor - right.legsAgainst - (left.legsFor - left.legsAgainst) ||
        right.legsFor - left.legsFor ||
        left.seed - right.seed,
    )
    .map((row, index) => ({
      position: index + 1,
      playerId: row.playerId,
      played: row.played,
      won: row.won,
      lost: row.lost,
      legsFor: row.legsFor,
      legsAgainst: row.legsAgainst,
      legDifference: row.legsFor - row.legsAgainst,
      points: row.points,
      withdrawn: input.withdrawnPlayerIds?.includes(row.playerId) ?? false,
    }));
}

export function resolveTournamentWithdrawals(input: {
  readonly withdrawnPlayerIds: readonly string[];
  readonly matches: readonly WithdrawalMatchSnapshot[];
}): readonly WithdrawalMatchDecision[] {
  const withdrawn = new Set(input.withdrawnPlayerIds);
  const matches = new Map(input.matches.map((match) => [match.id, { ...match }]));
  const decisions = new Map<string, WithdrawalMatchDecision>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const original of input.matches) {
      const match = matches.get(original.id);
      if (match === undefined || ["COMPLETED", "BYE", "CANCELLED"].includes(match.status)) continue;

      const firstSource = match.sourceOneMatchId === null ? null : matches.get(match.sourceOneMatchId);
      const secondSource = match.sourceTwoMatchId === null ? null : matches.get(match.sourceTwoMatchId);
      const participantOneId = match.participantOneId ?? firstSource?.winnerPlayerId ?? null;
      const participantTwoId = match.participantTwoId ?? secondSource?.winnerPlayerId ?? null;
      const firstResolved = participantOneId !== null || match.participantOneResolved === true || (firstSource !== null && firstSource !== undefined && ["COMPLETED", "BYE", "CANCELLED"].includes(firstSource.status));
      const secondResolved = participantTwoId !== null || match.participantTwoResolved === true || (secondSource !== null && secondSource !== undefined && ["COMPLETED", "BYE", "CANCELLED"].includes(secondSource.status));
      if (
        match.status === "IN_PROGRESS" &&
        !withdrawn.has(participantOneId ?? "") &&
        !withdrawn.has(participantTwoId ?? "")
      ) continue;
      let status: WithdrawalMatchDecision["status"] = match.status === "IN_PROGRESS" ? "READY" : match.status;
      let winnerPlayerId: string | null = null;
      let resultType: WithdrawalMatchDecision["resultType"] = null;

      if (firstResolved && secondResolved && participantOneId !== null && participantTwoId !== null) {
        const firstWithdrawn = withdrawn.has(participantOneId);
        const secondWithdrawn = withdrawn.has(participantTwoId);
        if (firstWithdrawn && secondWithdrawn) {
          status = "CANCELLED";
        } else if (firstWithdrawn || secondWithdrawn) {
          status = "COMPLETED";
          winnerPlayerId = firstWithdrawn ? participantTwoId : participantOneId;
          resultType = "WALKOVER";
        } else if (status === "WAITING") {
          status = "READY";
        }
      } else if (firstResolved && secondResolved) {
        const remainingPlayerId = participantOneId ?? participantTwoId;
        if (remainingPlayerId === null || withdrawn.has(remainingPlayerId)) {
          status = "CANCELLED";
        } else {
          status = "BYE";
          winnerPlayerId = remainingPlayerId;
          resultType = "BYE";
        }
      }

      if (
        participantOneId === match.participantOneId &&
        participantTwoId === match.participantTwoId &&
        status === match.status &&
        winnerPlayerId === match.winnerPlayerId
      ) continue;

      const next = { ...match, participantOneId, participantTwoId, status, winnerPlayerId };
      matches.set(match.id, next);
      decisions.set(match.id, { matchId: match.id, status, participantOneId, participantTwoId, winnerPlayerId, resultType });
      changed = true;
    }
  }

  return input.matches.flatMap((match) => {
    const decision = decisions.get(match.id);
    return decision === undefined ? [] : [decision];
  });
}

function roundRobinMatches(input: {
  readonly stageKey: string;
  readonly stageType: "GROUP" | "ROUND_ROBIN";
  readonly groupKey: string | null;
  readonly playerIds: readonly string[];
}): readonly PlannedMatch[] {
  return generateRoundRobin(input.playerIds).map((pairing) => ({
    key: `${input.stageKey}:r${pairing.round}:m${pairing.position}`,
    stageKey: input.stageKey,
    stageType: input.stageType,
    groupKey: input.groupKey,
    round: pairing.round,
    position: pairing.position,
    participantOne: { type: "PLAYER", playerId: pairing.playerOneId },
    participantTwo: { type: "PLAYER", playerId: pairing.playerTwoId },
    state: "READY",
    byeWinnerPlayerId: null,
  }));
}

export function createTournamentPlan(input: TournamentPlanInput): TournamentPlan {
  assertUniqueParticipants(input.participants);
  const ordered = [...input.participants].sort((left, right) => left.seed - right.seed);

  if (input.format === "ROUND_ROBIN") {
    return {
      groups: [],
      matches: roundRobinMatches({
        stageKey: "round-robin",
        stageType: "ROUND_ROBIN",
        groupKey: null,
        playerIds: ordered.map((participant) => participant.playerId),
      }),
    };
  }

  if (input.format === "SINGLE_ELIMINATION") {
    return {
      groups: [],
      matches: generateKnockoutBracket({
        stageKey: "knockout",
        participants: ordered.map((participant) => ({
          type: "PLAYER" as const,
          playerId: participant.playerId,
        })),
        bracketSize: input.knockoutSize,
      }),
    };
  }

  const groups = allocateGroups({
    participants: input.participants,
    groupCount: input.groupCount,
    seeding: input.seeding,
    ...(input.randomSeed === undefined ? {} : { randomSeed: input.randomSeed }),
  });
  const groupMatches = groups.flatMap((group) =>
    roundRobinMatches({
      stageKey: group.key,
      stageType: "GROUP",
      groupKey: group.key,
      playerIds: group.participants.map((participant) => participant.playerId),
    }),
  );
  const qualifiers = groups.flatMap((group) =>
    Array.from({ length: input.qualifyPerGroup }, (_, rank) => ({
      type: "GROUP_RANK" as const,
      groupKey: group.key,
      rank: rank + 1,
    })),
  );
  if (qualifiers.length !== input.knockoutSize) {
    throw new TournamentValidationError(
      "BRACKET_CAPACITY",
      "The knockout bracket size must equal the number of qualifiers.",
    );
  }
  return {
    groups,
    matches: [
      ...groupMatches,
      ...generateKnockoutBracket({
        stageKey: "knockout",
        participants: qualifiers,
        bracketSize: input.knockoutSize,
      }),
    ],
  };
}
