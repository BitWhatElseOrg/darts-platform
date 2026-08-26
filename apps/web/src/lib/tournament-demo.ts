import {
  tournamentDashboardSchema,
  tournamentListSchema,
  tournamentStructurePreviewSchema,
  type TournamentDashboard,
  type TournamentStructurePreview,
  type TournamentSummary,
} from "@darts-platform/schemas";

/**
 * SYNTHETIC DEMONSTRATION DATA — not a data source for production.
 *
 * The Phase-2 tournament endpoints do not exist yet (see ROADMAP.md). This
 * module stands in for them so the surface can be built and reviewed against
 * every designed state. Two rules keep it honest:
 *
 *  1. Every payload is parsed through the real Zod schemas from
 *     @darts-platform/schemas, so the fixture cannot drift from the contract
 *     the API will have to satisfy.
 *  2. Nothing here derives tournament facts the way the domain would. Standings,
 *     queue order, readiness, checkout routes and conflicts are written down as
 *     the server will hand them over — the client never computes them.
 *
 * Every name is invented. Replace this module with `apiRequest` calls to
 * `/organizations/:organizationId/tournaments/...` once the endpoints land.
 */

const ORGANIZATION_ID = "de000001-0000-4000-8000-000000000001";

/** Deterministic, well-formed UUIDs so fixtures stay stable across renders. */
function demoId(group: number, index: number): string {
  return `de${group.toString(16).padStart(6, "0")}-0000-4000-8000-${index
    .toString(16)
    .padStart(12, "0")}`;
}

const playerId = (index: number) => demoId(2, index);
const boardId = (index: number) => demoId(3, index);
const matchId = (index: number) => demoId(4, index);
const conflictId = (index: number) => demoId(5, index);

const TOURNAMENT_ID = demoId(1, 7);

/** A fixed clock: the fixture must not shift between server and client render. */
const NOW = new Date("2026-09-12T14:38:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

interface PlayerSeed {
  readonly index: number;
  readonly name: string;
}

const PLAYERS: readonly PlayerSeed[] = [
  { index: 1, name: "Reto Meier" },
  { index: 2, name: "Sandra Roth" },
  { index: 3, name: "Beat Frei" },
  { index: 4, name: "Céline Studer" },
  { index: 5, name: "Urs Keller" },
  { index: 6, name: "Nadja Suter" },
  { index: 7, name: "Dario Brun" },
  { index: 8, name: "Petra Odermatt" },
  { index: 9, name: "Yves Weber" },
  { index: 10, name: "Lea Bucher" },
  { index: 11, name: "Marco Ammann" },
  { index: 12, name: "Anne-Marie Zurbriggen-Loosli" },
  { index: 13, name: "Gian Gerber" },
  { index: 14, name: "Vera Vogt" },
  { index: 15, name: "Elias Hafner" },
  { index: 16, name: "Jasmin Zingg" },
  { index: 17, name: "Kurt Baumann" },
  { index: 18, name: "Fabienne Reber" },
  { index: 19, name: "Olivier Wyss" },
  { index: 20, name: "Heidi Lüthi" },
  { index: 21, name: "Ivo Kaufmann" },
  { index: 22, name: "Andrea Sigrist" },
  { index: 23, name: "Thomas Hofer" },
  { index: 24, name: "Zoé Blaser" },
  { index: 25, name: "Werner Rüegg" },
  { index: 26, name: "Michèle Marti" },
  { index: 27, name: "Bruno Iten" },
  { index: 28, name: "Silvia Bühler" },
  { index: 29, name: "Patrick Schwarz" },
  { index: 30, name: "Rahel Tanner" },
  { index: 31, name: "Daniel Egli" },
  { index: 32, name: "Corinne Ott" },
] as const;

const byName = new Map(PLAYERS.map((player) => [player.name, player]));

function player(name: string): PlayerSeed {
  const found = byName.get(name);
  if (!found) {
    throw new Error(`Demo fixture references an unknown player: ${name}`);
  }
  return found;
}

/** [name, played, won, legsFor, legsAgainst] — the shape a standings endpoint returns. */
type StandingSeed = readonly [string, number, number, number, number];

const GROUP_SEEDS: readonly (readonly [string, readonly StandingSeed[]])[] = [
  [
    "A",
    [
      ["Urs Keller", 3, 3, 9, 4],
      ["Nadja Suter", 3, 2, 7, 6],
      ["Olivier Wyss", 3, 1, 5, 8],
      ["Heidi Lüthi", 3, 0, 3, 9],
    ],
  ],
  [
    "B",
    [
      ["Dario Brun", 3, 2, 8, 5],
      ["Petra Odermatt", 3, 2, 7, 6],
      ["Bruno Iten", 3, 1, 6, 7],
      ["Silvia Bühler", 3, 1, 4, 8],
    ],
  ],
  [
    "C",
    [
      ["Reto Meier", 2, 2, 6, 2],
      ["Sandra Roth", 2, 1, 4, 4],
      ["Patrick Schwarz", 2, 1, 3, 5],
      ["Rahel Tanner", 2, 0, 2, 6],
    ],
  ],
  [
    "D",
    [
      ["Beat Frei", 2, 2, 6, 3],
      ["Céline Studer", 2, 1, 5, 4],
      ["Yves Weber", 1, 0, 1, 3],
      ["Lea Bucher", 1, 0, 2, 3],
    ],
  ],
  [
    "E",
    [
      ["Gian Gerber", 1, 1, 3, 1],
      ["Marco Ammann", 1, 1, 3, 2],
      ["Vera Vogt", 1, 0, 1, 3],
      ["Anne-Marie Zurbriggen-Loosli", 1, 0, 2, 3],
    ],
  ],
  [
    "F",
    [
      ["Elias Hafner", 2, 1, 5, 4],
      ["Werner Rüegg", 1, 1, 3, 1],
      ["Michèle Marti", 1, 1, 3, 2],
      ["Jasmin Zingg", 2, 0, 2, 6],
    ],
  ],
  [
    "G",
    [
      ["Ivo Kaufmann", 1, 1, 3, 0],
      ["Andrea Sigrist", 1, 1, 3, 2],
      ["Daniel Egli", 1, 0, 2, 3],
      ["Corinne Ott", 1, 0, 0, 3],
    ],
  ],
  [
    "H",
    [
      ["Kurt Baumann", 2, 2, 6, 1],
      ["Fabienne Reber", 2, 1, 4, 4],
      ["Thomas Hofer", 1, 0, 1, 3],
      ["Zoé Blaser", 1, 0, 2, 3],
    ],
  ],
] as const;

function buildGroups() {
  return GROUP_SEEDS.map(([groupLabel, seeds]) => {
    const playedMatches = seeds.reduce((total, [, played]) => total + played, 0) / 2;
    return {
      groupLabel,
      qualifyCount: 2,
      playedMatches,
      totalMatches: 6,
      rows: seeds.map(([name, played, won, legsFor, legsAgainst], rowIndex) => ({
        position: rowIndex + 1,
        playerId: playerId(player(name).index),
        displayName: name,
        played,
        won,
        lost: played - won,
        legsFor,
        legsAgainst,
        legDifference: legsFor - legsAgainst,
        points: won * 2,
        qualified: rowIndex < 2 && played > 0,
      })),
    };
  });
}

interface SlotSeed {
  readonly ring: number;
  readonly stage: string;
  readonly leg: number;
  readonly startedMinutesAgo: number;
  readonly overrunning?: boolean;
  readonly left: readonly [string, number, boolean, string | null];
  readonly right: readonly [string, number, boolean, string | null];
  readonly legsWon: readonly [number, number];
}

function runningSlot(seed: SlotSeed) {
  const [leftName, leftRemaining, leftActive, leftRoute] = seed.left;
  const [rightName, rightRemaining, rightActive, rightRoute] = seed.right;
  return {
    boardId: boardId(seed.ring),
    boardName: `Board ${seed.ring}`,
    ringNumber: seed.ring,
    state: "PLAYING" as const,
    blockedReason: null,
    match: {
      matchId: matchId(seed.ring),
      version: 40 + seed.ring,
      stageLabel: seed.stage,
      legNumber: seed.leg,
      bestOfLegs: 3,
      startedAt: minutesAgo(seed.startedMinutesAgo),
      overrunning: seed.overrunning ?? false,
      participants: [
        {
          playerId: playerId(player(leftName).index),
          displayName: leftName,
          remaining: leftRemaining,
          legsWon: seed.legsWon[0],
          isActive: leftActive,
          onFinish: leftRoute !== null,
          checkoutRoute: leftRoute,
        },
        {
          playerId: playerId(player(rightName).index),
          displayName: rightName,
          remaining: rightRemaining,
          legsWon: seed.legsWon[1],
          isActive: rightActive,
          onFinish: rightRoute !== null,
          checkoutRoute: rightRoute,
        },
      ] as const,
    },
  };
}

function freeSlot(ring: number) {
  return {
    boardId: boardId(ring),
    boardName: `Board ${ring}`,
    ringNumber: ring,
    state: "FREE" as const,
    blockedReason: null,
    match: null,
  };
}

function blockedSlot(ring: number, reason: string) {
  return {
    boardId: boardId(ring),
    boardName: `Board ${ring}`,
    ringNumber: ring,
    state: "BLOCKED" as const,
    blockedReason: reason,
    match: null,
  };
}

const RUNNING: readonly SlotSeed[] = [
  {
    ring: 1,
    stage: "Gruppe C",
    leg: 2,
    startedMinutesAgo: 12,
    left: ["Reto Meier", 72, true, "T20 D6"],
    right: ["Sandra Roth", 148, false, null],
    legsWon: [1, 0],
  },
  {
    ring: 2,
    stage: "Gruppe D",
    leg: 1,
    startedMinutesAgo: 4,
    left: ["Beat Frei", 301, false, null],
    right: ["Céline Studer", 244, true, null],
    legsWon: [0, 0],
  },
  {
    ring: 4,
    stage: "Gruppe A",
    leg: 3,
    startedMinutesAgo: 17,
    left: ["Urs Keller", 40, true, "D20"],
    right: ["Nadja Suter", 118, false, null],
    legsWon: [1, 1],
  },
  {
    ring: 5,
    stage: "Gruppe B",
    leg: 2,
    startedMinutesAgo: 9,
    left: ["Dario Brun", 180, false, null],
    right: ["Petra Odermatt", 96, true, null],
    legsWon: [0, 1],
  },
  {
    ring: 7,
    stage: "Gruppe F",
    leg: 3,
    startedMinutesAgo: 24,
    overrunning: true,
    left: ["Elias Hafner", 305, true, null],
    right: ["Jasmin Zingg", 288, false, null],
    legsWon: [1, 1],
  },
  {
    ring: 8,
    stage: "Gruppe H",
    leg: 2,
    startedMinutesAgo: 6,
    left: ["Kurt Baumann", 121, false, null],
    right: ["Fabienne Reber", 84, true, null],
    legsWon: [1, 0],
  },
] as const;

type QueueSeed = readonly [
  stage: string,
  left: string,
  right: string,
  readiness:
    | "READY"
    | "BLOCKED_PLAYER_BUSY"
    | "BLOCKED_PARTICIPANT_UNDECIDED"
    | "BLOCKED_NO_BOARD"
    | "BLOCKED_STAGE_NOT_OPEN",
  reason: string | null,
];

const QUEUE_SEEDS: readonly QueueSeed[] = [
  ["Gruppe D", "Yves Weber", "Lea Bucher", "READY", null],
  ["Gruppe E", "Gian Gerber", "Vera Vogt", "READY", null],
  [
    "Gruppe B",
    "Bruno Iten",
    "Petra Odermatt",
    "BLOCKED_PLAYER_BUSY",
    "Petra Odermatt spielt auf Board 5.",
  ],
  ["Gruppe G", "Ivo Kaufmann", "Daniel Egli", "READY", null],
  ["Gruppe H", "Thomas Hofer", "Zoé Blaser", "READY", null],
  [
    "Achtelfinale 1",
    "Sieger Gruppe A",
    "Zweiter Gruppe C",
    "BLOCKED_PARTICIPANT_UNDECIDED",
    "Gruppe C ist noch nicht entschieden.",
  ],
  ["Gruppe F", "Werner Rüegg", "Michèle Marti", "READY", null],
  ["Gruppe E", "Marco Ammann", "Anne-Marie Zurbriggen-Loosli", "READY", null],
] as const;

function buildQueue(seeds: readonly QueueSeed[] = QUEUE_SEEDS) {
  return seeds.map(([stageLabel, left, right, readiness, blockedReason], index) => ({
    matchId: matchId(60 + index),
    position: index + 1,
    stageLabel,
    readiness,
    blockedReason,
    participants: [
      {
        playerId: byName.has(left) ? playerId(player(left).index) : null,
        displayName: left,
      },
      {
        playerId: byName.has(right) ? playerId(player(right).index) : null,
        displayName: right,
      },
    ] as const,
  }));
}

const BASE_TOURNAMENT = {
  id: TOURNAMENT_ID,
  organizationId: ORGANIZATION_ID,
  name: "Vereinsmeisterschaft 2026",
  status: "GROUP_STAGE" as const,
  format: "GROUPS_THEN_KNOCKOUT" as const,
  version: 214,
  stageLabel: "Gruppenphase",
  startingScore: 501,
  doubleOut: true,
  playedMatches: 21,
  totalMatches: 63,
  startsAt: new Date("2026-09-12T12:00:00.000Z"),
};

export const DASHBOARD_SCENARIOS = [
  { id: "betrieb", label: "Normalbetrieb", note: "Ein Board frei, ein Board gesperrt." },
  { id: "vor-anwurf", label: "Vor dem Anwurf", note: "Alle acht Boards frei, nichts läuft." },
  { id: "voll", label: "Alles belegt", note: "Kein freies Board, lange Warteschlange." },
  { id: "stoerung", label: "Störung", note: "Doppelbelegung und gesperrtes Board." },
  { id: "gruppen-fertig", label: "Gruppen durch", note: "K.-o.-Runde noch nicht erzeugt." },
  { id: "beendet", label: "Turnier beendet", note: "Alles gespielt, Rangliste steht." },
] as const;

export type DashboardScenarioId = (typeof DASHBOARD_SCENARIOS)[number]["id"];

export const DEFAULT_SCENARIO: DashboardScenarioId = "betrieb";

export function isScenarioId(value: string | undefined): value is DashboardScenarioId {
  return DASHBOARD_SCENARIOS.some((scenario) => scenario.id === value);
}

/**
 * Stands in for `GET /organizations/:organizationId/tournaments/:tournamentId/dashboard`.
 * Parsing through the schema is deliberate: a fixture that no longer matches
 * the contract fails here rather than in the surface.
 */
export function loadDashboard(scenario: DashboardScenarioId): TournamentDashboard {
  const groups = buildGroups();

  if (scenario === "vor-anwurf") {
    return tournamentDashboardSchema.parse({
      tournament: {
        ...BASE_TOURNAMENT,
        status: "READY",
        stageLabel: "Bereit zum Anwurf",
        playedMatches: 0,
        version: 12,
      },
      boards: [1, 2, 3, 4, 5, 6, 7, 8].map(freeSlot),
      queue: buildQueue(QUEUE_SEEDS.slice(0, 6).map(
        ([stage, left, right]) => [stage, left, right, "READY", null] as const,
      )),
      conflicts: [],
      groups: groups.map((group) => ({
        ...group,
        playedMatches: 0,
        rows: group.rows.map((row) => ({
          ...row,
          played: 0,
          won: 0,
          lost: 0,
          legsFor: 0,
          legsAgainst: 0,
          legDifference: 0,
          points: 0,
          qualified: false,
        })),
      })),
      generatedAt: NOW,
    });
  }

  if (scenario === "voll") {
    return tournamentDashboardSchema.parse({
      tournament: BASE_TOURNAMENT,
      boards: [
        ...RUNNING.map(runningSlot),
        runningSlot({
          ring: 3,
          stage: "Gruppe G",
          leg: 1,
          startedMinutesAgo: 2,
          left: ["Andrea Sigrist", 421, true, null],
          right: ["Corinne Ott", 501, false, null],
          legsWon: [0, 0],
        }),
        runningSlot({
          ring: 6,
          stage: "Gruppe A",
          leg: 2,
          startedMinutesAgo: 8,
          left: ["Olivier Wyss", 60, true, "20 D20"],
          right: ["Heidi Lüthi", 233, false, null],
          legsWon: [1, 0],
        }),
      ].sort((left, right) => left.ringNumber - right.ringNumber),
      queue: buildQueue(),
      conflicts: [
        {
          id: conflictId(1),
          severity: "WARNING",
          code: "NO_BOARD_AVAILABLE",
          message:
            "Acht Matches warten, kein Board ist frei. Nächste Freigabe erwartet auf Board 4.",
          subject: "Warteschlange",
          detectedAt: minutesAgo(3),
        },
      ],
      groups,
      generatedAt: NOW,
    });
  }

  if (scenario === "stoerung") {
    return tournamentDashboardSchema.parse({
      tournament: BASE_TOURNAMENT,
      boards: [
        ...RUNNING.filter((seed) => seed.ring !== 7).map(runningSlot),
        runningSlot({
          ring: 7,
          stage: "Gruppe F",
          leg: 3,
          startedMinutesAgo: 41,
          overrunning: true,
          left: ["Elias Hafner", 305, true, null],
          right: ["Jasmin Zingg", 288, false, null],
          legsWon: [1, 1],
        }),
        blockedSlot(3, "Spinne verbogen. Board gesperrt seit 14:12."),
        blockedSlot(6, "Kein Schreiber am Board."),
      ].sort((left, right) => left.ringNumber - right.ringNumber),
      queue: buildQueue(),
      conflicts: [
        {
          id: conflictId(2),
          severity: "BLOCKING",
          code: "PLAYER_DOUBLE_BOOKED",
          message:
            "Jasmin Zingg ist auf Board 7 im Spiel und gleichzeitig für Gruppe F, Match 34 eingeteilt. Eines der beiden Matches muss verschoben werden.",
          subject: "Jasmin Zingg",
          detectedAt: minutesAgo(6),
        },
        {
          id: conflictId(3),
          severity: "WARNING",
          code: "BOARD_BLOCKED",
          message:
            "Zwei von acht Boards sind gesperrt. Die Gruppenphase verliert damit etwa 25 Minuten.",
          subject: "Board 3, Board 6",
          detectedAt: minutesAgo(26),
        },
        {
          id: conflictId(4),
          severity: "WARNING",
          code: "MATCH_OVERRUNNING",
          message: "Board 7 läuft seit 41 Minuten. Erwartet waren 18.",
          subject: "Board 7",
          detectedAt: minutesAgo(11),
        },
      ],
      groups,
      generatedAt: NOW,
    });
  }

  if (scenario === "gruppen-fertig") {
    return tournamentDashboardSchema.parse({
      tournament: {
        ...BASE_TOURNAMENT,
        stageLabel: "Gruppenphase abgeschlossen",
        playedMatches: 48,
        version: 402,
      },
      boards: [1, 2, 3, 4, 5, 6, 7, 8].map(freeSlot),
      queue: [],
      conflicts: [
        {
          id: conflictId(5),
          severity: "BLOCKING",
          code: "KNOCKOUT_NOT_GENERATED",
          message:
            "Alle 48 Gruppenmatches sind gespielt. Die K.-o.-Runde ist noch nicht erzeugt, deshalb wartet kein Match auf ein Board.",
          subject: "Turnierstruktur",
          detectedAt: minutesAgo(2),
        },
      ],
      groups: groups.map((group) => ({
        ...group,
        playedMatches: 6,
        rows: group.rows.map((row, rowIndex) => ({
          ...row,
          played: 3,
          won: [3, 2, 1, 0][rowIndex] ?? 0,
          lost: 3 - ([3, 2, 1, 0][rowIndex] ?? 0),
          points: ([3, 2, 1, 0][rowIndex] ?? 0) * 2,
          qualified: rowIndex < 2,
        })),
      })),
      generatedAt: NOW,
    });
  }

  if (scenario === "beendet") {
    return tournamentDashboardSchema.parse({
      tournament: {
        ...BASE_TOURNAMENT,
        status: "COMPLETED",
        stageLabel: "Turnier beendet",
        playedMatches: 63,
        version: 640,
      },
      boards: [1, 2, 3, 4, 5, 6, 7, 8].map(freeSlot),
      queue: [],
      conflicts: [],
      groups: groups.map((group) => ({
        ...group,
        playedMatches: 6,
        rows: group.rows.map((row, rowIndex) => ({
          ...row,
          played: 3,
          won: [3, 2, 1, 0][rowIndex] ?? 0,
          lost: 3 - ([3, 2, 1, 0][rowIndex] ?? 0),
          points: ([3, 2, 1, 0][rowIndex] ?? 0) * 2,
          qualified: rowIndex < 2,
        })),
      })),
      generatedAt: NOW,
    });
  }

  return tournamentDashboardSchema.parse({
    tournament: BASE_TOURNAMENT,
    boards: [
      ...RUNNING.map(runningSlot),
      freeSlot(3),
      blockedSlot(6, "Spinne verbogen. Board gesperrt seit 14:12."),
    ].sort((left, right) => left.ringNumber - right.ringNumber),
    queue: buildQueue(),
    conflicts: [
      {
        id: conflictId(6),
        severity: "WARNING",
        code: "MATCH_OVERRUNNING",
        message: "Board 7 läuft seit 24 Minuten. Erwartet waren 18.",
        subject: "Board 7",
        detectedAt: minutesAgo(6),
      },
      {
        id: conflictId(7),
        severity: "WARNING",
        code: "BOARD_BLOCKED",
        message: "Board 6 ist gesperrt. Die Gruppenphase verliert damit etwa 12 Minuten.",
        subject: "Board 6",
        detectedAt: minutesAgo(26),
      },
    ],
    groups,
    generatedAt: NOW,
  });
}

/** Stands in for `GET /organizations/:organizationId/tournaments`. */
export function loadTournaments(): readonly TournamentSummary[] {
  return tournamentListSchema.parse([
    {
      id: TOURNAMENT_ID,
      organizationId: ORGANIZATION_ID,
      name: "Vereinsmeisterschaft 2026",
      status: "GROUP_STAGE",
      format: "GROUPS_THEN_KNOCKOUT",
      participantCount: 32,
      boardCount: 8,
      playedMatches: 21,
      totalMatches: 63,
      startsAt: new Date("2026-09-12T12:00:00.000Z"),
      updatedAt: minutesAgo(1),
    },
    {
      id: demoId(1, 8),
      organizationId: ORGANIZATION_ID,
      name: "Herbst-Cup Doppel",
      status: "DRAFT",
      format: "SINGLE_ELIMINATION",
      participantCount: 12,
      boardCount: 4,
      playedMatches: 0,
      totalMatches: 0,
      startsAt: new Date("2026-10-24T17:00:00.000Z"),
      updatedAt: minutesAgo(2_880),
    },
    {
      id: demoId(1, 9),
      organizationId: ORGANIZATION_ID,
      name: "Frühlingsturnier 2026",
      status: "COMPLETED",
      format: "GROUPS_THEN_KNOCKOUT",
      participantCount: 24,
      boardCount: 6,
      playedMatches: 47,
      totalMatches: 47,
      startsAt: new Date("2026-04-18T16:00:00.000Z"),
      updatedAt: new Date("2026-04-18T22:41:00.000Z"),
    },
  ]);
}

/**
 * Stands in for `POST /organizations/:organizationId/tournaments/structure-preview`.
 * The real preview comes from the tournament engine; the setup sheet only
 * displays it, which is why this lives here and not in a component.
 */
export function loadStructurePreview(input: {
  readonly participantCount: number;
  readonly groupCount: number;
  readonly qualifyPerGroup: number;
  readonly knockoutSize: number;
}): TournamentStructurePreview {
  const base = Math.floor(input.participantCount / input.groupCount);
  const remainder = input.participantCount % input.groupCount;
  const groups = Array.from({ length: input.groupCount }, (_, index) => ({
    label: String.fromCharCode(65 + index),
    participantCount: base + (index < remainder ? 1 : 0),
  }));
  const groupMatchCount = groups.reduce(
    (total, group) => total + (group.participantCount * (group.participantCount - 1)) / 2,
    0,
  );
  const qualifiers = input.groupCount * input.qualifyPerGroup;
  const warnings: string[] = [];
  if (remainder !== 0) {
    warnings.push(
      `${input.participantCount} Teilnehmer lassen sich nicht gleichmässig auf ${input.groupCount} Gruppen verteilen. ${remainder} Gruppen spielen mit einem Spieler mehr.`,
    );
  }
  if (qualifiers > input.knockoutSize) {
    warnings.push(
      `${qualifiers} Qualifizierte passen nicht in ein ${input.knockoutSize}er-Tableau. Erhöhe die K.-o.-Grösse oder reduziere die Qualifikanten.`,
    );
  }
  return tournamentStructurePreviewSchema.parse({
    groups,
    groupMatchCount,
    knockoutSize: input.knockoutSize,
    knockoutMatchCount: Math.max(input.knockoutSize - 1, 0),
    byes: Math.max(input.knockoutSize - qualifiers, 0),
    totalMatches: groupMatchCount + Math.max(input.knockoutSize - 1, 0),
    warnings,
  });
}

export const DEMO_PLAYERS = PLAYERS.map((entry) => ({
  id: playerId(entry.index),
  displayName: entry.name,
}));

export const DEMO_BOARDS = [1, 2, 3, 4, 5, 6, 7, 8].map((ring) => ({
  id: boardId(ring),
  name: `Board ${ring}`,
  ringNumber: ring,
}));
