import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";

import { resolveDeciderRequirement, type Side } from "@darts-platform/league-engine";
import {
  encounterDetailSchema,
  encounterListSchema,
  publicEncounterSchema,
  type AssignEncounterSlotInput,
  type CancelEncounterInput,
  type CreateEncounterInput,
  type DeclareEncounterForfeitInput,
  type DeclareSlotWalkoverInput,
  type EncounterDetail,
  type EncounterSummary,
  type PublicEncounter,
  type ReleaseEncounterSlotInput,
  type StartEncounterInput,
  type SubmitDoublesInput,
  type SubmitNominationsInput,
  type SubstitutePlayerInput,
} from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { rethrowLeagueError } from "../common/league-error.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import {
  EncountersRepository,
  resolveSlotSides,
  type EncounterData,
  type EncounterMutationResult,
} from "./encounters.repository.js";
import { toResultInput } from "./update-encounter-progress.js";

export class EncounterVersionConflictException extends ConflictException {
  public constructor(currentState: EncounterDetail) {
    super({
      code: "ENCOUNTER_VERSION_CONFLICT",
      message: "Der Zustand der Begegnung hat sich geändert. Synchronisiere mit dem Serverzustand.",
      details: { currentState },
    });
  }
}

interface SummarySource {
  readonly encounter: EncounterData["encounter"];
  readonly homeTeamName: string;
  readonly awayTeamName: string;
}

function summary(data: SummarySource): Record<string, unknown> {
  const { encounter } = data;
  return {
    id: encounter.id,
    publicId: encounter.publicId,
    organizationId: encounter.organizationId,
    competitionId: encounter.competitionId,
    matchday: encounter.matchday,
    homeTeamId: encounter.homeTeamId,
    homeTeamName: data.homeTeamName,
    awayTeamId: encounter.awayTeamId,
    awayTeamName: data.awayTeamName,
    scheduledAt: encounter.scheduledAt,
    venue: encounter.venue,
    status: encounter.status,
    version: encounter.version,
    homePoints: encounter.homePoints,
    awayPoints: encounter.awayPoints,
    homeGames: encounter.homeGames,
    awayGames: encounter.awayGames,
    homeLegs: encounter.homeLegs,
    awayLegs: encounter.awayLegs,
    result: encounter.result,
    resultType: encounter.resultType,
    completedAt: encounter.completedAt,
  };
}

function slotViews(data: EncounterData): Record<string, unknown>[] {
  const names = new Map<string, string>();
  for (const nomination of data.nominations) names.set(nomination.playerId, nomination.displayName);
  for (const entry of data.lineupEntries) names.set(entry.playerId, entry.displayName);
  for (const substitution of data.substitutions) {
    names.set(substitution.outPlayerId, substitution.outDisplayName);
    names.set(substitution.inPlayerId, substitution.inDisplayName);
  }
  const pairingsOf = (side: Side): { slotId: string; playerIds: string[] }[] => {
    const bySlot = new Map<string, string[]>();
    for (const entry of data.lineupEntries) {
      if (entry.side !== side) continue;
      const existing = bySlot.get(entry.slotId) ?? [];
      existing.push(entry.playerId);
      bySlot.set(entry.slotId, existing);
    }
    return [...bySlot].map(([slotId, playerIds]) => ({ slotId, playerIds }));
  };
  const homePairings = pairingsOf("HOME");
  const awayPairings = pairingsOf("AWAY");
  const nominations = data.nominations.map((entry) => ({
    side: entry.side,
    playerId: entry.playerId,
    position: entry.position,
    origin: entry.origin,
  }));

  return data.slots.map((slot) => {
    const occupancy = resolveSlotSides(
      slot,
      nominations,
      data.substitutions,
      homePairings,
      awayPairings,
    );
    const side = (playerIds: readonly string[], expected: number): Record<string, unknown> => ({
      players: playerIds.map((playerId) => ({
        playerId,
        displayName: names.get(playerId) ?? "Unbekannte Person",
      })),
      complete: playerIds.length === expected,
    });
    const expected = slot.discipline === "DOUBLES" ? 2 : 1;
    return {
      id: slot.id,
      sequence: slot.sequence,
      role: slot.role,
      discipline: slot.discipline,
      label: slot.label,
      homePosition: slot.homePosition,
      awayPosition: slot.awayPosition,
      startingScore: slot.startingScore,
      inRule: slot.inRule,
      outRule: slot.outRule,
      maxRounds: slot.maxRounds,
      bestOfLegs: slot.bestOfLegs,
      legsToWinSet: slot.legsToWinSet,
      setsToWin: slot.setsToWin,
      status: slot.status,
      boardId: slot.boardId,
      boardName: slot.boardName,
      matchId: slot.matchId,
      winnerSide: slot.winnerSide,
      resultType: slot.resultType,
      homeLegs: slot.homeLegs,
      awayLegs: slot.awayLegs,
      version: slot.version,
      completedAt: slot.completedAt,
      home: side(occupancy.home.playerIds, expected),
      away: side(occupancy.away.playerIds, expected),
    };
  });
}

/**
 * Reglement 2.1.1 erlaubt dem Heim-Captain, verdeckt zu melden. Erst wenn
 * beide Seiten gemeldet haben, gibt der Server die Meldungen heraus. Das ist
 * eine Serverentscheidung; ausgeblendete Bedienelemente wären keine.
 */
function sideLineup(
  data: EncounterData,
  side: Side,
  revealed: boolean,
): Record<string, unknown> {
  const nominations = data.nominations.filter((entry) => entry.side === side);
  return {
    side,
    teamId: side === "HOME" ? data.encounter.homeTeamId : data.encounter.awayTeamId,
    teamName: side === "HOME" ? data.homeTeamName : data.awayTeamName,
    submitted: nominations.length > 0,
    revealed,
    nominations: revealed
      ? nominations.map((entry) => ({
          playerId: entry.playerId,
          displayName: entry.displayName,
          position: entry.position,
          origin: entry.origin,
        }))
      : [],
    substitutions: revealed
      ? data.substitutions
          .filter((entry) => entry.side === side)
          .map((entry) => ({
            id: entry.id,
            side: entry.side,
            position: entry.position,
            outPlayerId: entry.outPlayerId,
            outDisplayName: entry.outDisplayName,
            inPlayerId: entry.inPlayerId,
            inDisplayName: entry.inDisplayName,
            effectiveFromSequence: entry.effectiveFromSequence,
            reason: entry.reason,
            createdAt: entry.createdAt,
          }))
      : [],
  };
}

function toDetail(data: EncounterData): unknown {
  const homeSubmitted = data.nominations.some((entry) => entry.side === "HOME");
  const awaySubmitted = data.nominations.some((entry) => entry.side === "AWAY");
  const revealed = homeSubmitted && awaySubmitted;
  const decider = resolveDeciderRequirement(toResultInput(data.competition, data.slots));
  return {
    ...summary(data),
    competitionName: data.competition.name,
    deciderRule: data.competition.deciderRule,
    lineupPositions: data.competition.lineupPositions,
    minNominations: data.competition.minNominations,
    minNominationsShorthanded: data.competition.minNominationsShorthanded,
    maxSubstitutionsPerEncounter: data.competition.maxSubstitutionsPerEncounter,
    maxDoublesPerPlayer: data.competition.maxDoublesPerPlayer,
    decider,
    home: sideLineup(data, "HOME", revealed),
    away: sideLineup(data, "AWAY", revealed),
    slots: slotViews(data),
  };
}

function toPublic(data: EncounterData, generatedAt: Date): unknown {
  const { encounter } = data;
  return {
    publicId: encounter.publicId,
    competitionName: data.competition.name,
    matchday: encounter.matchday,
    homeTeamName: data.homeTeamName,
    awayTeamName: data.awayTeamName,
    scheduledAt: encounter.scheduledAt,
    venue: encounter.venue,
    status: encounter.status,
    homePoints: encounter.homePoints,
    awayPoints: encounter.awayPoints,
    homeGames: encounter.homeGames,
    awayGames: encounter.awayGames,
    homeLegs: encounter.homeLegs,
    awayLegs: encounter.awayLegs,
    result: encounter.result,
    resultType: encounter.resultType,
    completedAt: encounter.completedAt,
    slots: slotViews(data).map((slot) => ({
      sequence: slot.sequence,
      role: slot.role,
      discipline: slot.discipline,
      label: slot.label,
      status: slot.status,
      boardName: slot.boardName,
      winnerSide: slot.winnerSide,
      resultType: slot.resultType,
      homeLegs: slot.homeLegs,
      awayLegs: slot.awayLegs,
      home: slot.home,
      away: slot.away,
    })),
    generatedAt,
  };
}

type Permission = "encounter:read" | "encounter:manage" | "encounter:lineup";

@Injectable()
export class EncountersService {
  public constructor(
    @Inject(EncountersRepository) private readonly repository: EncountersRepository,
    @Inject(OrganizationAccessService) private readonly access: OrganizationAccessService,
  ) {}

  public async list(input: {
    readonly organizationId: string;
    readonly competitionId: string;
    readonly auth: AuthContext;
  }): Promise<EncounterSummary[]> {
    await this.require(input, "encounter:read");
    const rows = await this.repository.listByCompetition(input);
    return encounterListSchema.parse(
      rows.map((row) =>
        summary({
          encounter: row,
          homeTeamName: row.homeTeamName,
          awayTeamName: row.awayTeamName,
        }),
      ),
    );
  }

  public async get(input: {
    readonly organizationId: string;
    readonly encounterId: string;
    readonly auth: AuthContext;
  }): Promise<EncounterDetail> {
    await this.require(input, "encounter:read");
    return encounterDetailSchema.parse(toDetail(await this.load(input)));
  }

  public async publicView(publicId: string): Promise<PublicEncounter> {
    const data = await this.repository.getPublicData(publicId);
    if (data === null) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Encounter not found." });
    }
    return publicEncounterSchema.parse(toPublic(data, new Date()));
  }

  public async schedule(input: {
    readonly organizationId: string;
    readonly competitionId: string;
    readonly data: CreateEncounterInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<EncounterDetail> {
    await this.require(input, "encounter:manage");
    const created = await this.repository.schedule(input);
    if (created.status === "template-empty") {
      throw new UnprocessableEntityException({
        code: "TEMPLATE_INVALID",
        message: "Der Wettbewerb trägt keine Begegnungsvorlage.",
      });
    }
    if (created.status !== "ok") {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message:
          created.status === "team-not-found" ? "Team not found." : "Competition not found.",
      });
    }
    return this.get({
      organizationId: input.organizationId,
      encounterId: created.encounterId,
      auth: input.auth,
    });
  }

  public submitNominations(input: EncounterCommandInput<SubmitNominationsInput>): Promise<EncounterDetail> {
    return this.command(input, "encounter:lineup", () => this.repository.submitNominations(input));
  }

  public submitDoubles(input: EncounterCommandInput<SubmitDoublesInput>): Promise<EncounterDetail> {
    return this.command(input, "encounter:lineup", () => this.repository.submitDoubles(input));
  }

  public substitute(input: EncounterCommandInput<SubstitutePlayerInput>): Promise<EncounterDetail> {
    return this.command(input, "encounter:lineup", () => this.repository.substitute(input));
  }

  public start(input: EncounterCommandInput<StartEncounterInput>): Promise<EncounterDetail> {
    return this.command(input, "encounter:manage", () => this.repository.start(input));
  }

  public assignSlot(
    input: EncounterCommandInput<AssignEncounterSlotInput> & { readonly slotId: string },
  ): Promise<EncounterDetail> {
    return this.command(input, "board:assign", () => this.repository.assignSlot(input));
  }

  public releaseSlot(
    input: EncounterCommandInput<ReleaseEncounterSlotInput> & { readonly slotId: string },
  ): Promise<EncounterDetail> {
    return this.command(input, "board:assign", () => this.repository.releaseSlot(input));
  }

  public declareSlotWalkover(
    input: EncounterCommandInput<DeclareSlotWalkoverInput> & { readonly slotId: string },
  ): Promise<EncounterDetail> {
    return this.command(input, "encounter:manage", () =>
      this.repository.declareSlotWalkover(input),
    );
  }

  public declareForfeit(
    input: EncounterCommandInput<DeclareEncounterForfeitInput>,
  ): Promise<EncounterDetail> {
    return this.command(input, "encounter:manage", () => this.repository.declareForfeit(input));
  }

  public cancel(input: EncounterCommandInput<CancelEncounterInput>): Promise<EncounterDetail> {
    return this.command(input, "encounter:manage", () => this.repository.cancel(input));
  }

  private async command<T>(
    input: EncounterCommandInput<T>,
    permission: Permission | "board:assign",
    mutation: () => Promise<EncounterMutationResult>,
  ): Promise<EncounterDetail> {
    await this.access.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission,
    });
    let result: EncounterMutationResult;
    try {
      result = await mutation();
    } catch (error) {
      rethrowLeagueError(error);
    }
    if (result === "not-found" || result === "slot-not-found") {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: result === "slot-not-found" ? "Slot not found." : "Encounter not found.",
      });
    }
    const current = await this.get(input);
    if (result === "ok") return current;
    throw conflictFor(result, current);
  }

  private async load(input: {
    readonly organizationId: string;
    readonly encounterId: string;
  }): Promise<EncounterData> {
    const data = await this.repository.getData(input);
    if (data === null) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Encounter not found." });
    }
    return data;
  }

  private async require(
    input: { readonly organizationId: string; readonly auth: AuthContext },
    permission: Permission,
  ): Promise<void> {
    await this.access.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission,
    });
  }
}

interface EncounterCommandInput<T> {
  readonly organizationId: string;
  readonly encounterId: string;
  readonly data: T;
  readonly auth: AuthContext;
  readonly audit: AuditContext;
}

function conflictFor(
  result: Exclude<EncounterMutationResult, "ok" | "not-found" | "slot-not-found">,
  currentState: EncounterDetail,
): ConflictException | UnprocessableEntityException {
  const details = { currentState };
  switch (result) {
    case "version-conflict":
      return new EncounterVersionConflictException(currentState);
    case "command-id-reused":
      return new ConflictException({
        code: "COMMAND_ID_ALREADY_USED",
        message: "Diese commandId gehört zu einer anderen Begegnung.",
        details,
      });
    case "encounter-closed":
      return new ConflictException({
        code: "ENCOUNTER_CLOSED",
        message: "Die Begegnung ist beendet oder abgebrochen.",
        details,
      });
    case "invalid-status":
      return new ConflictException({
        code: "ENCOUNTER_STATUS_INVALID",
        message: "Der Status der Begegnung lässt diesen Schritt nicht zu.",
        details,
      });
    case "lineups-incomplete":
      return new UnprocessableEntityException({
        code: "NOMINATION_INCOMPLETE",
        message: "Beide Seiten brauchen eine ausreichende Meldung.",
        details,
      });
    case "slot-not-ready":
      return new ConflictException({
        code: "ENCOUNTER_SLOT_NOT_READY",
        message: "Der Slot ist nicht startbereit.",
        details,
      });
    case "slot-running":
      // `SUBSTITUTION_SLOT_RUNNING` gehört der Auswechslung und kommt aus der
      // Engine; hier geht es um Doppelmeldung, Rücknahme, Walkover und Abbruch.
      return new ConflictException({
        code: "ENCOUNTER_SLOT_RUNNING",
        message: "Der Slot läuft bereits.",
        details,
      });
    case "board-unavailable":
      return new ConflictException({
        code: "BOARD_UNAVAILABLE",
        message: "Das Board ist nicht verfügbar.",
        details,
      });
    case "player-busy":
      return new ConflictException({
        code: "PLAYER_BUSY",
        message: "Mindestens eine Person spielt bereits.",
        details,
      });
  }
}
