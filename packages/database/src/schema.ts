import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: varchar("token", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("sessions_token_unique").on(table.token),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: varchar("account_id", { length: 255 }).notNull(),
    providerId: varchar("provider_id", { length: 255 }).notNull(),
    issuer: varchar("issuer", { length: 255 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("accounts_issuer_account_unique").on(
      table.issuer,
      table.accountId,
    ),
    index("accounts_user_id_idx").on(table.userId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: varchar("identifier", { length: 320 }).notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    timezone: varchar("timezone", { length: 100 }).notNull(),
    locale: varchar("locale", { length: 35 }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organizations_slug_unique").on(table.slug),
    check("organizations_slug_not_empty", sql`length(trim(${table.slug})) > 0`),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 50 }).notNull(),
    status: varchar("status", { length: 30 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("memberships_organization_user_unique").on(
      table.organizationId,
      table.userId,
    ),
    index("memberships_organization_id_idx").on(table.organizationId),
    index("memberships_user_id_idx").on(table.userId),
    check(
      "memberships_role_check",
      sql`${table.role} in ('OWNER', 'ADMIN', 'TOURNAMENT_DIRECTOR', 'SCORER', 'MEMBER', 'VIEWER')`,
    ),
    check(
      "memberships_status_check",
      sql`${table.status} in ('INVITED', 'ACTIVE', 'SUSPENDED')`,
    ),
  ],
);

export const players = pgTable(
  "players",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    publicId: uuid("public_id").defaultRandom().notNull(),
    firstName: varchar("first_name", { length: 100 }),
    lastName: varchar("last_name", { length: 100 }),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    nickname: varchar("nickname", { length: 100 }),
    email: varchar("email", { length: 320 }),
    externalReference: varchar("external_reference", { length: 255 }),
    status: varchar("status", { length: 30 }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("players_public_id_unique").on(table.publicId),
    uniqueIndex("players_organization_external_reference_unique").on(
      table.organizationId,
      table.externalReference,
    ),
    index("players_organization_id_idx").on(table.organizationId),
    index("players_organization_display_name_idx").on(
      table.organizationId,
      table.displayName,
    ),
    check(
      "players_display_name_not_empty",
      sql`length(trim(${table.displayName})) > 0`,
    ),
    check(
      "players_status_check",
      sql`${table.status} in ('ACTIVE', 'INACTIVE')`,
    ),
  ],
);

export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    role: varchar("role", { length: 50 }).notNull(),
    status: varchar("status", { length: 30 }).default("PENDING").notNull(),
    claimTokenHash: varchar("claim_token_hash", { length: 64 }),
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("organization_invitations_organization_id_idx").on(
      table.organizationId,
    ),
    index("organization_invitations_email_status_idx").on(
      table.email,
      table.status,
    ),
    check(
      "organization_invitations_role_check",
      sql`${table.role} in ('OWNER', 'ADMIN', 'TOURNAMENT_DIRECTOR', 'SCORER', 'MEMBER', 'VIEWER')`,
    ),
    check(
      "organization_invitations_status_check",
      sql`${table.status} in ('PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED')`,
    ),
    check(
      "organization_invitations_pending_claim_check",
      sql`${table.status} <> 'PENDING' or ${table.claimTokenHash} is not null`,
    ),
    check(
      "organization_invitations_claim_hash_format_check",
      sql`${table.claimTokenHash} is null or ${table.claimTokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: uuid("entity_id"),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_events_organization_created_at_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("audit_events_entity_idx").on(table.entityType, table.entityId),
    index("audit_events_correlation_id_idx").on(table.correlationId),
  ],
);

export const boards = pgTable(
  "boards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    status: varchar("status", { length: 30 }).default("AVAILABLE").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("boards_organization_name_unique").on(table.organizationId, table.name),
    index("boards_organization_id_idx").on(table.organizationId),
    check("boards_name_not_empty", sql`length(trim(${table.name})) > 0`),
    check("boards_status_check", sql`${table.status} in ('AVAILABLE', 'IN_USE', 'OFFLINE')`),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "set null" }),
    status: varchar("status", { length: 30 }).default("IN_PROGRESS").notNull(),
    startingScore: integer("starting_score").default(501).notNull(),
    inRule: varchar("in_rule", { length: 10 }).default("STRAIGHT").notNull(),
    outRule: varchar("out_rule", { length: 10 }).default("DOUBLE").notNull(),
    maxRounds: integer("max_rounds"),
    bestOfLegs: integer("best_of_legs").notNull(),
    legsToWinSet: integer("legs_to_win_set").default(2).notNull(),
    setsToWin: integer("sets_to_win").default(1).notNull(),
    version: integer("version").default(0).notNull(),
    startingSeat: integer("starting_seat").notNull(),
    currentSeat: integer("current_seat"),
    winnerSeat: integer("winner_seat"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("matches_organization_status_idx").on(table.organizationId, table.status),
    index("matches_board_id_idx").on(table.boardId),
    check("matches_status_check", sql`${table.status} in ('IN_PROGRESS', 'COMPLETED', 'ABORTED')`),
    check("matches_starting_score_check", sql`${table.startingScore} >= 2`),
    check("matches_best_of_legs_check", sql`${table.bestOfLegs} > 0 and mod(${table.bestOfLegs}, 2) = 1`),
    check("matches_legs_to_win_set_check", sql`${table.legsToWinSet} > 0`),
    check("matches_sets_to_win_check", sql`${table.setsToWin} > 0`),
    check("matches_version_check", sql`${table.version} >= 0`),
    check("matches_in_rule_check", sql`${table.inRule} in ('STRAIGHT', 'DOUBLE')`),
    check("matches_out_rule_check", sql`${table.outRule} in ('SINGLE', 'DOUBLE', 'MASTER')`),
    check("matches_max_rounds_check", sql`${table.maxRounds} is null or ${table.maxRounds} > 0`),
    check("matches_starting_seat_check", sql`${table.startingSeat} in (1, 2)`),
    check("matches_current_seat_check", sql`${table.currentSeat} is null or ${table.currentSeat} in (1, 2)`),
    check("matches_winner_seat_check", sql`${table.winnerSeat} is null or ${table.winnerSeat} in (1, 2)`),
  ],
);

export const boardControllerLeases = pgTable(
  "board_controller_leases",
  {
    matchId: uuid("match_id").primaryKey().references(() => matches.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    controllerId: uuid("controller_id").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("board_controller_leases_organization_expiry_idx").on(table.organizationId, table.expiresAt)],
);

export const matchParticipants = pgTable(
  "match_participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    seat: integer("seat").notNull(),
    legsWon: integer("legs_won").default(0).notNull(),
  },
  (table) => [
    uniqueIndex("match_participants_match_seat_unique").on(table.matchId, table.seat),
    index("match_participants_organization_id_idx").on(table.organizationId),
    check("match_participants_seat_check", sql`${table.seat} in (1, 2)`),
    check("match_participants_legs_won_check", sql`${table.legsWon} >= 0`),
  ],
);

export const matchParticipantPlayers = pgTable(
  "match_participant_players",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => matchParticipants.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
  },
  (table) => [
    uniqueIndex("match_participant_players_participant_position_unique").on(table.participantId, table.position),
    uniqueIndex("match_participant_players_match_player_unique").on(table.matchId, table.playerId),
    index("match_participant_players_organization_player_idx").on(table.organizationId, table.playerId),
    check("match_participant_players_position_check", sql`${table.position} in (1, 2)`),
  ],
);

export const legs = pgTable(
  "legs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    legNumber: integer("leg_number").notNull(),
    startingSeat: integer("starting_seat").notNull(),
    winnerSeat: integer("winner_seat"),
    status: varchar("status", { length: 30 }).default("IN_PROGRESS").notNull(),
    version: integer("version").default(0).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("legs_match_number_unique").on(table.matchId, table.legNumber),
    index("legs_organization_match_idx").on(table.organizationId, table.matchId),
    check("legs_number_check", sql`${table.legNumber} > 0`),
    check("legs_status_check", sql`${table.status} in ('IN_PROGRESS', 'COMPLETED')`),
    check("legs_version_check", sql`${table.version} >= 0`),
    check("legs_starting_seat_check", sql`${table.startingSeat} in (1, 2)`),
    check("legs_winner_seat_check", sql`${table.winnerSeat} is null or ${table.winnerSeat} in (1, 2)`),
  ],
);

export const visits = pgTable(
  "visits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    legId: uuid("leg_id")
      .notNull()
      .references(() => legs.id, { onDelete: "cascade" }),
    throwerPlayerId: uuid("thrower_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    seat: integer("seat").notNull(),
    commandId: uuid("command_id").notNull(),
    sequence: integer("sequence").notNull(),
    points: integer("points").notNull(),
    appliedPoints: integer("applied_points").notNull(),
    dartsThrown: integer("darts_thrown").notNull(),
    scoreBefore: integer("score_before").notNull(),
    scoreAfter: integer("score_after").notNull(),
    checkoutDouble: integer("checkout_double"),
    checkoutAttempts: integer("checkout_attempts").default(0).notNull(),
    outcome: varchar("outcome", { length: 30 }).notNull(),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    revertedByCommandId: uuid("reverted_by_command_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("visits_command_id_unique").on(table.commandId),
    uniqueIndex("visits_match_sequence_unique").on(table.matchId, table.sequence),
    index("visits_organization_match_idx").on(table.organizationId, table.matchId),
    index("visits_leg_id_idx").on(table.legId),
    index("visits_organization_thrower_idx").on(table.organizationId, table.throwerPlayerId),
    check("visits_points_check", sql`${table.points} between 0 and 180`),
    check("visits_applied_points_check", sql`${table.appliedPoints} between 0 and 180`),
    check("visits_darts_check", sql`${table.dartsThrown} between 1 and 3`),
    check("visits_scores_check", sql`${table.scoreBefore} >= 0 and ${table.scoreAfter} >= 0`),
    check("visits_checkout_double_check", sql`${table.checkoutDouble} is null or ${table.checkoutDouble} between 1 and 20 or ${table.checkoutDouble} = 25`),
    check("visits_checkout_attempts_check", sql`${table.checkoutAttempts} between 0 and ${table.dartsThrown}`),
    check("visits_outcome_check", sql`${table.outcome} in ('SCORED', 'BUST', 'LEG_WON', 'SET_WON', 'MATCH_WON')`),
    check("visits_seat_check", sql`${table.seat} in (1, 2)`),
  ],
);

/**
 * Die einzelnen Wuerfe einer Aufnahme. Sie haengen am Visit; eine
 * zurueckgenommene Aufnahme behaelt ihre Wuerfe, `visits.reverted_at` bleibt
 * die einzige Wahrheit ueber den Widerruf.
 */
export const visitDarts = pgTable(
  "visit_darts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    dartIndex: integer("dart_index").notNull(),
    segment: integer("segment").notNull(),
    multiplier: integer("multiplier").notNull(),
    value: integer("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("visit_darts_visit_index_unique").on(table.visitId, table.dartIndex),
    index("visit_darts_organization_visit_idx").on(table.organizationId, table.visitId),
    check("visit_darts_index_check", sql`${table.dartIndex} between 1 and 3`),
    check("visit_darts_segment_check", sql`${table.segment} between 0 and 20 or ${table.segment} = 25`),
    check("visit_darts_multiplier_check", sql`${table.multiplier} between 1 and 3`),
    check("visit_darts_miss_check", sql`${table.segment} <> 0 or ${table.multiplier} = 1`),
    check("visit_darts_bull_check", sql`${table.segment} <> 25 or ${table.multiplier} <= 2`),
    check("visit_darts_value_check", sql`${table.value} = ${table.segment} * ${table.multiplier}`),
  ],
);

export const scoreCommands = pgTable(
  "score_commands",
  {
    commandId: uuid("command_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 30 }).notNull(),
    payload: jsonb("payload").notNull(),
    resultingVersion: integer("resulting_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("score_commands_organization_match_idx").on(table.organizationId, table.matchId),
    check(
      "score_commands_type_check",
      sql`${table.type} in ('SUBMIT_VISIT', 'UNDO_LAST_VISIT', 'ABORT_MATCH', 'DECIDE_LEG_START', 'DECIDE_LEG_BY_BULL')`,
    ),
    check("score_commands_version_check", sql`${table.resultingVersion} >= 0`),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    aggregateType: varchar("aggregate_type", { length: 100 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    statisticsProcessedAt: timestamp("statistics_processed_at", { withTimezone: true }),
  },
  (table) => [
    index("outbox_events_unpublished_idx").on(table.publishedAt, table.occurredAt),
    index("outbox_events_organization_aggregate_idx").on(table.organizationId, table.aggregateId),
  ],
);

export const playerStatisticAggregates = pgTable(
  "player_statistic_aggregates",
  {
    playerId: uuid("player_id")
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("player_statistic_aggregates_organization_idx").on(table.organizationId)],
);

export const tournaments = pgTable(
  "tournaments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    status: varchar("status", { length: 30 }).default("READY").notNull(),
    format: varchar("format", { length: 40 }).notNull(),
    version: integer("version").default(0).notNull(),
    startingScore: integer("starting_score").default(501).notNull(),
    inRule: varchar("in_rule", { length: 10 }).default("STRAIGHT").notNull(),
    outRule: varchar("out_rule", { length: 10 }).default("DOUBLE").notNull(),
    maxRounds: integer("max_rounds"),
    bestOfLegs: integer("best_of_legs").default(3).notNull(),
    legsToWinSet: integer("legs_to_win_set").default(2).notNull(),
    setsToWin: integer("sets_to_win").default(1).notNull(),
    groupCount: integer("group_count").notNull(),
    qualifyPerGroup: integer("qualify_per_group").notNull(),
    knockoutSize: integer("knockout_size").notNull(),
    seeding: varchar("seeding", { length: 20 }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("tournaments_organization_status_idx").on(table.organizationId, table.status),
    index("tournaments_organization_starts_at_idx").on(table.organizationId, table.startsAt),
    check("tournaments_name_not_empty", sql`length(trim(${table.name})) > 0`),
    check(
      "tournaments_status_check",
      sql`${table.status} in ('READY', 'GROUP_STAGE', 'KNOCKOUT', 'COMPLETED')`,
    ),
    check(
      "tournaments_format_check",
      sql`${table.format} in ('GROUPS_THEN_KNOCKOUT', 'ROUND_ROBIN', 'SINGLE_ELIMINATION')`,
    ),
    check("tournaments_version_check", sql`${table.version} >= 0`),
    check("tournaments_starting_score_check", sql`${table.startingScore} in (301, 501, 701)`),
    check("tournaments_in_rule_check", sql`${table.inRule} in ('STRAIGHT', 'DOUBLE')`),
    check("tournaments_out_rule_check", sql`${table.outRule} in ('SINGLE', 'DOUBLE', 'MASTER')`),
    check("tournaments_max_rounds_check", sql`${table.maxRounds} is null or ${table.maxRounds} > 0`),
    check(
      "tournaments_best_of_legs_check",
      sql`${table.bestOfLegs} > 0 and mod(${table.bestOfLegs}, 2) = 1`,
    ),
    check("tournaments_legs_to_win_set_check", sql`${table.legsToWinSet} > 0`),
    check("tournaments_sets_to_win_check", sql`${table.setsToWin} > 0`),
    check("tournaments_group_count_check", sql`${table.groupCount} between 1 and 32`),
    check(
      "tournaments_qualify_per_group_check",
      sql`${table.qualifyPerGroup} between 1 and 8`,
    ),
    check(
      "tournaments_knockout_size_check",
      sql`${table.knockoutSize} in (2, 4, 8, 16, 32, 64)`,
    ),
    check("tournaments_seeding_check", sql`${table.seeding} in ('SEEDED', 'RANDOM')`),
  ],
);

export const tournamentParticipants = pgTable(
  "tournament_participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    seed: integer("seed").notNull(),
    status: varchar("status", { length: 20 }).default("ACTIVE").notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawalReason: text("withdrawal_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("tournament_participants_tournament_player_unique").on(
      table.tournamentId,
      table.playerId,
    ),
    uniqueIndex("tournament_participants_tournament_seed_unique").on(
      table.tournamentId,
      table.seed,
    ),
    index("tournament_participants_organization_idx").on(table.organizationId),
    check("tournament_participants_seed_check", sql`${table.seed} > 0`),
    check("tournament_participants_status_check", sql`${table.status} in ('ACTIVE', 'WITHDRAWN')`),
    check(
      "tournament_participants_withdrawal_check",
      sql`(${table.status} = 'ACTIVE' and ${table.withdrawnAt} is null and ${table.withdrawalReason} is null) or (${table.status} = 'WITHDRAWN' and ${table.withdrawnAt} is not null and ${table.withdrawalReason} is not null and length(trim(${table.withdrawalReason})) between 3 and 500)`,
    ),
  ],
);

export const tournamentBoards = pgTable(
  "tournament_boards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "restrict" }),
    ringNumber: integer("ring_number").notNull(),
  },
  (table) => [
    uniqueIndex("tournament_boards_tournament_board_unique").on(
      table.tournamentId,
      table.boardId,
    ),
    uniqueIndex("tournament_boards_tournament_ring_unique").on(
      table.tournamentId,
      table.ringNumber,
    ),
    index("tournament_boards_organization_idx").on(table.organizationId),
    check("tournament_boards_ring_check", sql`${table.ringNumber} > 0`),
  ],
);

export const tournamentStages = pgTable(
  "tournament_stages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 80 }).notNull(),
    sequence: integer("sequence").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    type: varchar("type", { length: 40 }).notNull(),
    status: varchar("status", { length: 30 }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tournament_stages_tournament_key_unique").on(table.tournamentId, table.key),
    uniqueIndex("tournament_stages_tournament_sequence_unique").on(
      table.tournamentId,
      table.sequence,
    ),
    index("tournament_stages_organization_idx").on(table.organizationId),
    check("tournament_stages_sequence_check", sql`${table.sequence} > 0`),
    check(
      "tournament_stages_type_check",
      sql`${table.type} in ('GROUP', 'ROUND_ROBIN', 'SINGLE_ELIMINATION')`,
    ),
    check(
      "tournament_stages_status_check",
      sql`${table.status} in ('OPEN', 'WAITING', 'COMPLETED')`,
    ),
  ],
);

export const tournamentGroups = pgTable(
  "tournament_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => tournamentStages.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 80 }).notNull(),
    label: varchar("label", { length: 20 }).notNull(),
    sequence: integer("sequence").notNull(),
    qualifyCount: integer("qualify_count").notNull(),
  },
  (table) => [
    uniqueIndex("tournament_groups_tournament_key_unique").on(table.tournamentId, table.key),
    uniqueIndex("tournament_groups_stage_sequence_unique").on(table.stageId, table.sequence),
    index("tournament_groups_organization_idx").on(table.organizationId),
    check("tournament_groups_sequence_check", sql`${table.sequence} > 0`),
    check("tournament_groups_qualify_count_check", sql`${table.qualifyCount} > 0`),
  ],
);

export const tournamentGroupParticipants = pgTable(
  "tournament_group_participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => tournamentGroups.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    seed: integer("seed").notNull(),
  },
  (table) => [
    uniqueIndex("tournament_group_participants_group_player_unique").on(
      table.groupId,
      table.playerId,
    ),
    uniqueIndex("tournament_group_participants_tournament_player_unique").on(
      table.tournamentId,
      table.playerId,
    ),
    index("tournament_group_participants_organization_idx").on(table.organizationId),
    check("tournament_group_participants_seed_check", sql`${table.seed} > 0`),
  ],
);

export const tournamentMatches = pgTable(
  "tournament_matches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => tournamentStages.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => tournamentGroups.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 120 }).notNull(),
    stageLabel: varchar("stage_label", { length: 120 }).notNull(),
    round: integer("round").notNull(),
    position: integer("position").notNull(),
    status: varchar("status", { length: 30 }).notNull(),
    participantOneId: uuid("participant_one_id").references(() => players.id, {
      onDelete: "restrict",
    }),
    participantTwoId: uuid("participant_two_id").references(() => players.id, {
      onDelete: "restrict",
    }),
    participantOneRef: jsonb("participant_one_ref"),
    participantTwoRef: jsonb("participant_two_ref"),
    sourceOneMatchId: uuid("source_one_match_id"),
    sourceTwoMatchId: uuid("source_two_match_id"),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "set null" }),
    scoringMatchId: uuid("scoring_match_id").references(() => matches.id, {
      onDelete: "set null",
    }),
    winnerPlayerId: uuid("winner_player_id").references(() => players.id, {
      onDelete: "restrict",
    }),
    resultType: varchar("result_type", { length: 20 }),
    version: integer("version").default(0).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tournament_matches_tournament_key_unique").on(table.tournamentId, table.key),
    uniqueIndex("tournament_matches_scoring_match_unique").on(table.scoringMatchId),
    uniqueIndex("tournament_matches_active_board_unique")
      .on(table.boardId)
      .where(sql`${table.status} = 'IN_PROGRESS'`),
    index("tournament_matches_organization_tournament_status_idx").on(
      table.organizationId,
      table.tournamentId,
      table.status,
    ),
    index("tournament_matches_source_one_idx").on(table.sourceOneMatchId),
    index("tournament_matches_source_two_idx").on(table.sourceTwoMatchId),
    check("tournament_matches_round_check", sql`${table.round} > 0`),
    check("tournament_matches_position_check", sql`${table.position} > 0`),
    check("tournament_matches_version_check", sql`${table.version} >= 0`),
    check(
      "tournament_matches_status_check",
      sql`${table.status} in ('WAITING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'BYE', 'CANCELLED')`,
    ),
    check("tournament_matches_result_type_check", sql`${table.resultType} is null or ${table.resultType} in ('PLAYED', 'BYE', 'WALKOVER')`),
    check(
      "tournament_matches_result_type_consistency",
      sql`(${table.status} = 'COMPLETED' and ${table.resultType} is not null and ${table.resultType} in ('PLAYED', 'WALKOVER')) or (${table.status} = 'BYE' and ${table.resultType} is not null and ${table.resultType} = 'BYE') or (${table.status} not in ('COMPLETED', 'BYE') and ${table.resultType} is null)`,
    ),
    check(
      "tournament_matches_participants_different",
      sql`${table.participantOneId} is null or ${table.participantTwoId} is null or ${table.participantOneId} <> ${table.participantTwoId}`,
    ),
  ],
);

export const tournamentCommands = pgTable(
  "tournament_commands",
  {
    commandId: uuid("command_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 30 }).notNull(),
    payload: jsonb("payload").notNull(),
    resultingVersion: integer("resulting_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("tournament_commands_organization_tournament_idx").on(
      table.organizationId,
      table.tournamentId,
    ),
    check(
      "tournament_commands_type_check",
      sql`${table.type} in ('ASSIGN_MATCH', 'RELEASE_BOARD', 'RESULT_CORRECTION', 'WITHDRAW_PARTICIPANT')`,
    ),
    check("tournament_commands_version_check", sql`${table.resultingVersion} >= 0`),
  ],
);


export const teams = pgTable(
  "teams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    shortName: varchar("short_name", { length: 20 }),
    status: varchar("status", { length: 30 }).default("ACTIVE").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("teams_organization_name_unique").on(table.organizationId, table.name),
    index("teams_organization_status_idx").on(table.organizationId, table.status),
    check("teams_name_not_empty", sql`length(trim(${table.name})) > 0`),
    check("teams_status_check", sql`${table.status} in ('ACTIVE', 'ARCHIVED')`),
  ],
);

export const teamPlayers = pgTable(
  "team_players",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    role: varchar("role", { length: 20 }).default("PLAYER").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).defaultNow().notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("team_players_team_player_from_unique").on(
      table.teamId,
      table.playerId,
      table.validFrom,
    ),
    uniqueIndex("team_players_team_player_active_unique")
      .on(table.teamId, table.playerId)
      .where(sql`${table.validTo} is null`),
    // Eine Mannschaft führt genau einen aktiven Captain (Reglement 1.2.1).
    uniqueIndex("team_players_team_captain_unique")
      .on(table.teamId)
      .where(sql`${table.validTo} is null and ${table.role} = 'CAPTAIN'`),
    index("team_players_organization_player_idx").on(table.organizationId, table.playerId),
    check("team_players_role_check", sql`${table.role} in ('PLAYER', 'CAPTAIN')`),
    check(
      "team_players_validity_check",
      sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);

export const competitions = pgTable(
  "competitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 20 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    status: varchar("status", { length: 30 }).notNull(),
    pointsWin: integer("points_win").default(3).notNull(),
    pointsDraw: integer("points_draw").default(1).notNull(),
    pointsLoss: integer("points_loss").default(0).notNull(),
    pointsDeciderBonus: integer("points_decider_bonus").default(0).notNull(),
    deciderRule: varchar("decider_rule", { length: 20 }).default("NONE").notNull(),
    lineupPositions: integer("lineup_positions").default(4).notNull(),
    minNominations: integer("min_nominations").default(4).notNull(),
    minNominationsShorthanded: integer("min_nominations_shorthanded").default(3).notNull(),
    maxSubstitutionsPerEncounter: integer("max_substitutions_per_encounter").default(4).notNull(),
    maxDoublesPerPlayer: integer("max_doubles_per_player").default(1).notNull(),
    version: integer("version").default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("competitions_organization_slug_unique").on(table.organizationId, table.slug),
    index("competitions_organization_status_idx").on(table.organizationId, table.status),
    check("competitions_type_check", sql`${table.type} in ('LEAGUE')`),
    check(
      "competitions_status_check",
      sql`${table.status} in ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')`,
    ),
    check("competitions_decider_rule_check", sql`${table.deciderRule} in ('NONE', 'EXTRA_SLOT')`),
    check(
      "competitions_points_order_check",
      sql`${table.pointsWin} >= ${table.pointsDraw} and ${table.pointsDraw} >= ${table.pointsLoss}`,
    ),
    check("competitions_points_loss_check", sql`${table.pointsLoss} >= 0`),
    check("competitions_decider_bonus_check", sql`${table.pointsDeciderBonus} >= 0`),
    check(
      "competitions_decider_bonus_rule_check",
      sql`${table.pointsDeciderBonus} = 0 or ${table.deciderRule} = 'EXTRA_SLOT'`,
    ),
    check("competitions_lineup_positions_check", sql`${table.lineupPositions} > 0`),
    check(
      "competitions_min_nominations_check",
      sql`${table.minNominations} >= ${table.lineupPositions}`,
    ),
    check(
      "competitions_min_nominations_shorthanded_check",
      sql`${table.minNominationsShorthanded} > 0 and ${table.minNominationsShorthanded} <= ${table.minNominations}`,
    ),
    check("competitions_max_substitutions_check", sql`${table.maxSubstitutionsPerEncounter} >= 0`),
    check("competitions_max_doubles_check", sql`${table.maxDoublesPerPlayer} >= 0`),
    check("competitions_version_check", sql`${table.version} >= 0`),
  ],
);

export const competitionSlots = pgTable(
  "competition_slots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    role: varchar("role", { length: 20 }).default("REGULAR").notNull(),
    discipline: varchar("discipline", { length: 20 }).notNull(),
    label: varchar("label", { length: 60 }).notNull(),
    homePosition: integer("home_position"),
    awayPosition: integer("away_position"),
    startingScore: integer("starting_score").notNull(),
    inRule: varchar("in_rule", { length: 10 }).default("STRAIGHT").notNull(),
    outRule: varchar("out_rule", { length: 10 }).default("DOUBLE").notNull(),
    maxRounds: integer("max_rounds"),
    bestOfLegs: integer("best_of_legs").notNull(),
    legsToWinSet: integer("legs_to_win_set").default(2).notNull(),
    setsToWin: integer("sets_to_win").default(1).notNull(),
  },
  (table) => [
    uniqueIndex("competition_slots_competition_sequence_unique").on(
      table.competitionId,
      table.sequence,
    ),
    uniqueIndex("competition_slots_competition_decider_unique")
      .on(table.competitionId, table.role)
      .where(sql`${table.role} = 'DECIDER'`),
    uniqueIndex("competition_slots_singles_pairing_unique")
      .on(table.competitionId, table.homePosition, table.awayPosition)
      .where(sql`${table.discipline} = 'SINGLES'`),
    index("competition_slots_organization_idx").on(table.organizationId, table.competitionId),
    check("competition_slots_role_check", sql`${table.role} in ('REGULAR', 'DECIDER')`),
    check(
      "competition_slots_discipline_check",
      sql`${table.discipline} in ('SINGLES', 'DOUBLES')`,
    ),
    check("competition_slots_sequence_check", sql`${table.sequence} > 0`),
    check("competition_slots_starting_score_check", sql`${table.startingScore} in (301, 501, 701)`),
    check("competition_slots_in_rule_check", sql`${table.inRule} in ('STRAIGHT', 'DOUBLE')`),
    check("competition_slots_out_rule_check", sql`${table.outRule} in ('SINGLE', 'DOUBLE', 'MASTER')`),
    check("competition_slots_max_rounds_check", sql`${table.maxRounds} is null or ${table.maxRounds} > 0`),
    check(
      "competition_slots_best_of_legs_check",
      sql`${table.bestOfLegs} > 0 and mod(${table.bestOfLegs}, 2) = 1`,
    ),
    check(
      "competition_slots_distance_check",
      sql`${table.legsToWinSet} > 0 and ${table.setsToWin} > 0`,
    ),
    check(
      "competition_slots_positions_discipline_check",
      sql`(${table.discipline} = 'SINGLES') = (${table.homePosition} is not null)`,
    ),
    check(
      "competition_slots_positions_pair_check",
      sql`(${table.homePosition} is null) = (${table.awayPosition} is null)`,
    ),
    check(
      "competition_slots_home_position_check",
      sql`${table.homePosition} is null or ${table.homePosition} > 0`,
    ),
    check(
      "competition_slots_away_position_check",
      sql`${table.awayPosition} is null or ${table.awayPosition} > 0`,
    ),
  ],
);

export const encounters = pgTable(
  "encounters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    publicId: uuid("public_id").defaultRandom().notNull(),
    matchday: integer("matchday").notNull(),
    homeTeamId: uuid("home_team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    awayTeamId: uuid("away_team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    venue: varchar("venue", { length: 120 }),
    status: varchar("status", { length: 30 }).default("DRAFT").notNull(),
    version: integer("version").default(0).notNull(),
    homePoints: integer("home_points").default(0).notNull(),
    awayPoints: integer("away_points").default(0).notNull(),
    homeGames: integer("home_games").default(0).notNull(),
    awayGames: integer("away_games").default(0).notNull(),
    homeLegs: integer("home_legs").default(0).notNull(),
    awayLegs: integer("away_legs").default(0).notNull(),
    result: varchar("result", { length: 20 }),
    resultType: varchar("result_type", { length: 20 }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("encounters_public_id_unique").on(table.publicId),
    uniqueIndex("encounters_matchday_home_unique").on(
      table.competitionId,
      table.matchday,
      table.homeTeamId,
    ),
    uniqueIndex("encounters_matchday_away_unique").on(
      table.competitionId,
      table.matchday,
      table.awayTeamId,
    ),
    index("encounters_organization_competition_status_idx").on(
      table.organizationId,
      table.competitionId,
      table.status,
    ),
    index("encounters_organization_scheduled_idx").on(table.organizationId, table.scheduledAt),
    check("encounters_teams_distinct_check", sql`${table.homeTeamId} <> ${table.awayTeamId}`),
    check("encounters_matchday_check", sql`${table.matchday} > 0`),
    check("encounters_version_check", sql`${table.version} >= 0`),
    check(
      "encounters_status_check",
      sql`${table.status} in ('DRAFT', 'LINEUPS_OPEN', 'READY', 'RUNNING', 'COMPLETED', 'CANCELLED')`,
    ),
    check(
      "encounters_result_check",
      sql`${table.result} is null or ${table.result} in ('HOME_WIN', 'AWAY_WIN', 'DRAW')`,
    ),
    check(
      "encounters_result_type_check",
      sql`${table.resultType} is null or ${table.resultType} in ('PLAYED', 'DECIDER', 'FORFEIT')`,
    ),
    check(
      "encounters_completed_result_check",
      sql`(${table.status} = 'COMPLETED') = (${table.result} is not null)`,
    ),
    check(
      "encounters_result_pair_check",
      sql`(${table.result} is null) = (${table.resultType} is null)`,
    ),
    check(
      "encounters_draw_result_type_check",
      sql`${table.result} <> 'DRAW' or ${table.resultType} = 'PLAYED'`,
    ),
  ],
);

export const encounterSlots = pgTable(
  "encounter_slots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    discipline: varchar("discipline", { length: 20 }).notNull(),
    label: varchar("label", { length: 60 }).notNull(),
    homePosition: integer("home_position"),
    awayPosition: integer("away_position"),
    startingScore: integer("starting_score").notNull(),
    inRule: varchar("in_rule", { length: 10 }).notNull(),
    outRule: varchar("out_rule", { length: 10 }).notNull(),
    maxRounds: integer("max_rounds"),
    bestOfLegs: integer("best_of_legs").notNull(),
    legsToWinSet: integer("legs_to_win_set").notNull(),
    setsToWin: integer("sets_to_win").notNull(),
    status: varchar("status", { length: 30 }).default("WAITING").notNull(),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "set null" }),
    matchId: uuid("match_id").references(() => matches.id, { onDelete: "set null" }),
    winnerSide: varchar("winner_side", { length: 10 }),
    resultType: varchar("result_type", { length: 20 }),
    homeLegs: integer("home_legs").default(0).notNull(),
    awayLegs: integer("away_legs").default(0).notNull(),
    version: integer("version").default(0).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("encounter_slots_encounter_sequence_unique").on(table.encounterId, table.sequence),
    uniqueIndex("encounter_slots_match_unique").on(table.matchId),
    uniqueIndex("encounter_slots_board_in_progress_unique")
      .on(table.boardId)
      .where(sql`${table.status} = 'IN_PROGRESS'`),
    index("encounter_slots_organization_encounter_status_idx").on(
      table.organizationId,
      table.encounterId,
      table.status,
    ),
    check(
      "encounter_slots_status_check",
      sql`${table.status} in ('WAITING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'WALKOVER', 'CANCELLED')`,
    ),
    check("encounter_slots_role_check", sql`${table.role} in ('REGULAR', 'DECIDER')`),
    check("encounter_slots_discipline_check", sql`${table.discipline} in ('SINGLES', 'DOUBLES')`),
    check("encounter_slots_sequence_check", sql`${table.sequence} > 0`),
    check("encounter_slots_version_check", sql`${table.version} >= 0`),
    check(
      "encounter_slots_winner_side_check",
      sql`${table.winnerSide} is null or ${table.winnerSide} in ('HOME', 'AWAY')`,
    ),
    check(
      "encounter_slots_result_type_check",
      sql`${table.resultType} is null or ${table.resultType} in ('PLAYED', 'WALKOVER')`,
    ),
    check(
      "encounter_slots_result_status_check",
      sql`(${table.status} in ('COMPLETED', 'WALKOVER')) = (${table.resultType} is not null)`,
    ),
    check(
      "encounter_slots_result_winner_check",
      sql`${table.resultType} is null or ${table.winnerSide} is not null`,
    ),
    check(
      "encounter_slots_walkover_match_check",
      sql`${table.resultType} <> 'WALKOVER' or ${table.matchId} is null`,
    ),
    check(
      "encounter_slots_positions_discipline_check",
      sql`(${table.discipline} = 'SINGLES') = (${table.homePosition} is not null)`,
    ),
    check(
      "encounter_slots_positions_pair_check",
      sql`(${table.homePosition} is null) = (${table.awayPosition} is null)`,
    ),
    check("encounter_slots_legs_check", sql`${table.homeLegs} >= 0 and ${table.awayLegs} >= 0`),
  ],
);

export const encounterNominations = pgTable(
  "encounter_nominations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    side: varchar("side", { length: 10 }).notNull(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    position: integer("position"),
    origin: varchar("origin", { length: 20 }).default("SQUAD").notNull(),
  },
  (table) => [
    uniqueIndex("encounter_nominations_side_player_unique").on(
      table.encounterId,
      table.side,
      table.playerId,
    ),
    uniqueIndex("encounter_nominations_side_position_unique").on(
      table.encounterId,
      table.side,
      table.position,
    ),
    index("encounter_nominations_organization_encounter_idx").on(
      table.organizationId,
      table.encounterId,
    ),
    index("encounter_nominations_encounter_player_idx").on(table.encounterId, table.playerId),
    check("encounter_nominations_side_check", sql`${table.side} in ('HOME', 'AWAY')`),
    check(
      "encounter_nominations_position_check",
      sql`${table.position} is null or ${table.position} > 0`,
    ),
    check("encounter_nominations_origin_check", sql`${table.origin} in ('SQUAD', 'GUEST')`),
  ],
);

export const encounterLineupEntries = pgTable(
  "encounter_lineup_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => encounterSlots.id, { onDelete: "cascade" }),
    side: varchar("side", { length: 10 }).notNull(),
    position: integer("position").notNull(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("encounter_lineup_entries_slot_side_position_unique").on(
      table.slotId,
      table.side,
      table.position,
    ),
    uniqueIndex("encounter_lineup_entries_slot_side_player_unique").on(
      table.slotId,
      table.side,
      table.playerId,
    ),
    index("encounter_lineup_entries_organization_encounter_idx").on(
      table.organizationId,
      table.encounterId,
    ),
    index("encounter_lineup_entries_encounter_player_idx").on(table.encounterId, table.playerId),
    check("encounter_lineup_entries_side_check", sql`${table.side} in ('HOME', 'AWAY')`),
    check("encounter_lineup_entries_position_check", sql`${table.position} in (1, 2)`),
  ],
);

export const encounterSubstitutions = pgTable(
  "encounter_substitutions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    side: varchar("side", { length: 10 }).notNull(),
    position: integer("position").notNull(),
    outPlayerId: uuid("out_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    inPlayerId: uuid("in_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    effectiveFromSequence: integer("effective_from_sequence").notNull(),
    reason: varchar("reason", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("encounter_substitutions_side_position_sequence_unique").on(
      table.encounterId,
      table.side,
      table.position,
      table.effectiveFromSequence,
    ),
    index("encounter_substitutions_organization_encounter_idx").on(
      table.organizationId,
      table.encounterId,
    ),
    check("encounter_substitutions_side_check", sql`${table.side} in ('HOME', 'AWAY')`),
    check("encounter_substitutions_position_check", sql`${table.position} > 0`),
    check("encounter_substitutions_sequence_check", sql`${table.effectiveFromSequence} > 0`),
    check(
      "encounter_substitutions_players_distinct_check",
      sql`${table.outPlayerId} <> ${table.inPlayerId}`,
    ),
  ],
);

export const encounterCommands = pgTable(
  "encounter_commands",
  {
    commandId: uuid("command_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 30 }).notNull(),
    payload: jsonb("payload").notNull(),
    resultingVersion: integer("resulting_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("encounter_commands_organization_encounter_idx").on(
      table.organizationId,
      table.encounterId,
    ),
    check(
      "encounter_commands_type_check",
      sql`${table.type} in ('SUBMIT_NOMINATIONS', 'SUBMIT_DOUBLES', 'SUBSTITUTE_PLAYER', 'START_ENCOUNTER', 'ASSIGN_SLOT', 'RELEASE_BOARD', 'DECLARE_WALKOVER', 'DECLARE_ENCOUNTER_FORFEIT', 'CANCEL_ENCOUNTER')`,
    ),
    check("encounter_commands_version_check", sql`${table.resultingVersion} >= 0`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
export type OrganizationInvitation = typeof organizationInvitations.$inferSelect;
export type NewOrganizationInvitation = typeof organizationInvitations.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
export type Board = typeof boards.$inferSelect;
export type BoardControllerLease = typeof boardControllerLeases.$inferSelect;
export type Match = typeof matches.$inferSelect;
export type MatchParticipant = typeof matchParticipants.$inferSelect;
export type Leg = typeof legs.$inferSelect;
export type Visit = typeof visits.$inferSelect;
export type VisitDart = typeof visitDarts.$inferSelect;
export type ScoreCommand = typeof scoreCommands.$inferSelect;
export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type PlayerStatisticAggregate = typeof playerStatisticAggregates.$inferSelect;
export type Tournament = typeof tournaments.$inferSelect;
export type TournamentParticipant = typeof tournamentParticipants.$inferSelect;
export type TournamentBoard = typeof tournamentBoards.$inferSelect;
export type TournamentStage = typeof tournamentStages.$inferSelect;
export type TournamentGroup = typeof tournamentGroups.$inferSelect;
export type TournamentGroupParticipant = typeof tournamentGroupParticipants.$inferSelect;
export type TournamentMatch = typeof tournamentMatches.$inferSelect;
export type TournamentCommand = typeof tournamentCommands.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamPlayer = typeof teamPlayers.$inferSelect;
export type NewTeamPlayer = typeof teamPlayers.$inferInsert;
export type Competition = typeof competitions.$inferSelect;
export type NewCompetition = typeof competitions.$inferInsert;
export type CompetitionSlot = typeof competitionSlots.$inferSelect;
export type NewCompetitionSlot = typeof competitionSlots.$inferInsert;
export type Encounter = typeof encounters.$inferSelect;
export type NewEncounter = typeof encounters.$inferInsert;
export type EncounterSlot = typeof encounterSlots.$inferSelect;
export type NewEncounterSlot = typeof encounterSlots.$inferInsert;
export type EncounterNomination = typeof encounterNominations.$inferSelect;
export type NewEncounterNomination = typeof encounterNominations.$inferInsert;
export type EncounterLineupEntry = typeof encounterLineupEntries.$inferSelect;
export type NewEncounterLineupEntry = typeof encounterLineupEntries.$inferInsert;
export type EncounterSubstitution = typeof encounterSubstitutions.$inferSelect;
export type NewEncounterSubstitution = typeof encounterSubstitutions.$inferInsert;
export type EncounterCommand = typeof encounterCommands.$inferSelect;
