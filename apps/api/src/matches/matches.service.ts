import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { decideDeviceMatchAccess, isDevicePermission } from "@darts-platform/domain";
import { abortMatchResponseSchema, boardControllerLeaseSchema, matchListSchema, matchStateSchema, type AbortMatchInput, type AbortMatchResponse, type BoardControllerLeaseResponse, type CreateMatchInput, type DecideLegByBullInput, type DecideLegStartInput, type MatchStateResponse, type SubmitVisitInput, type UndoVisitInput } from "@darts-platform/schemas";
import { isDevicePrincipal, type AuthContext, type Principal } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { rethrowScoringError } from "../common/scoring-error.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { MatchesRepository, type DeviceDenial, type UndoMutationResult } from "./matches.repository.js";

/** Antwort auf ein Match, das nicht auf der Scheibe des Geraets steht. */
function deviceBoardMismatch(): ForbiddenException {
  return new ForbiddenException({ code: "DEVICE_BOARD_MISMATCH", message: "This match is not on this device's board." });
}

/** Uebersetzt die Ablehnung eines Geraets aus dem Repository in die HTTP-Antwort. */
function deviceDenialException(denial: DeviceDenial): ForbiddenException | ConflictException {
  switch (denial) {
    case "device-board-mismatch":
      return deviceBoardMismatch();
    case "device-match-not-active":
      return new ConflictException({ code: "DEVICE_MATCH_NOT_ACTIVE", message: "This match is not active." });
    default: {
      const exhaustive: never = denial;
      return exhaustive;
    }
  }
}

export class MatchVersionConflictException extends ConflictException {
  public constructor(currentState: MatchStateResponse | null) {
    super({ code: "MATCH_VERSION_CONFLICT", message: "The match state changed. Synchronize with the current server state.", details: { currentState } });
  }
}

@Injectable()
export class MatchesService {
  public constructor(
    @Inject(MatchesRepository) private readonly repository: MatchesRepository,
    @Inject(OrganizationAccessService) private readonly access: OrganizationAccessService,
  ) {}

  public async list(input: { readonly organizationId: string; readonly auth: AuthContext }): Promise<MatchStateResponse[]> {
    await this.require(input, "match:read");
    return matchListSchema.parse(await this.repository.list(input.organizationId));
  }

  public async get(input: { readonly organizationId: string; readonly matchId: string; readonly auth: Principal }): Promise<MatchStateResponse> {
    await this.require(input, "match:read");
    const state = await this.repository.getState(input.organizationId, input.matchId);
    if (state === null) throw new NotFoundException("Match not found.");
    this.requireDeviceMayRead(input.auth, state);
    return matchStateSchema.parse(state);
  }

  public async create(input: { readonly organizationId: string; readonly data: CreateMatchInput; readonly auth: AuthContext; readonly audit: AuditContext }): Promise<MatchStateResponse> {
    await this.require(input, "match:create");
    try {
      const id = await this.repository.create(input);
      const state = await this.repository.getState(input.organizationId, id);
      if (state === null) throw new Error("Created match could not be loaded.");
      return matchStateSchema.parse(state);
    } catch (error) {
      this.rethrowDomainError(error);
    }
  }

  public async submitVisit(input: { readonly organizationId: string; readonly matchId: string; readonly data: SubmitVisitInput; readonly auth: Principal; readonly audit: AuditContext }): Promise<MatchStateResponse> {
    await this.require(input, "match:score");
    return this.mutate(input, () => this.repository.submitVisit(input));
  }

  public async undo(input: { readonly organizationId: string; readonly matchId: string; readonly data: UndoVisitInput; readonly auth: Principal; readonly audit: AuditContext }): Promise<MatchStateResponse> {
    await this.require(input, "match:undo");
    return this.mutate(input, () => this.repository.undo(input));
  }

  public async decideLegStart(input: { readonly organizationId: string; readonly matchId: string; readonly data: DecideLegStartInput; readonly auth: Principal; readonly audit: AuditContext }): Promise<MatchStateResponse> {
    await this.require(input, "match:score");
    return this.mutate(input, () => this.repository.decideLegStart(input));
  }

  public async decideLegByBull(input: { readonly organizationId: string; readonly matchId: string; readonly data: DecideLegByBullInput; readonly auth: Principal; readonly audit: AuditContext }): Promise<MatchStateResponse> {
    await this.require(input, "match:score");
    return this.mutate(input, () => this.repository.decideLegByBull(input));
  }

  public async abort(input: { readonly organizationId: string; readonly matchId: string; readonly data: AbortMatchInput; readonly auth: AuthContext; readonly audit: AuditContext }): Promise<AbortMatchResponse> {
    await this.require(input, "match:abort");
    try {
      const result = await this.repository.abort(input);
      if (result === "not-found") throw new NotFoundException("Match not found.");
      if (result === "version-conflict" || result === "controller-conflict") {
        const state = await this.repository.getState(input.organizationId, input.matchId);
        if (result === "version-conflict") throw new MatchVersionConflictException(state);
        if (state === null) throw new NotFoundException("Match not found.");
        throw new ConflictException({ code: "BOARD_CONTROLLER_CONFLICT", message: "Ein anderes Gerät steuert dieses Board.", details: { currentState: state } });
      }
      return abortMatchResponseSchema.parse(result);
    } catch (error) {
      this.rethrowDomainError(error);
    }
  }

  public async acquireControllerLease(input: { readonly organizationId: string; readonly matchId: string; readonly controllerId: string; readonly force: boolean; readonly auth: Principal; readonly audit: AuditContext }): Promise<BoardControllerLeaseResponse> {
    await this.require(input, "match:score");
    const lease = await this.repository.acquireControllerLease(input);
    if (lease === null) throw new NotFoundException("Match not found.");
    if (lease === "device-board-mismatch" || lease === "device-match-not-active") throw deviceDenialException(lease);
    return boardControllerLeaseSchema.parse(lease);
  }

  private async mutate(input: { readonly organizationId: string; readonly matchId: string; readonly auth: Principal }, mutation: () => Promise<UndoMutationResult>): Promise<MatchStateResponse> {
    try {
      const result = await mutation();
      if (result === "not-found") throw new NotFoundException("Match not found.");
      if (result === "device-board-mismatch" || result === "device-match-not-active") throw deviceDenialException(result);
      const state = await this.repository.getState(input.organizationId, input.matchId);
      // Eine wiederholte commandId bestaetigt das Repository mit "ok", bevor es
      // das Match liest und die Scheibe prueft. Ohne diese zweite Pruefung
      // bekaeme ein Geraet den Zustand eines Matches einer anderen Scheibe.
      if (state !== null) this.requireDeviceMayRead(input.auth, state);
      if (result === "version-conflict") throw new MatchVersionConflictException(state === null ? null : matchStateSchema.parse(state));
      if (state === null) throw new NotFoundException("Match not found.");
      const parsed = matchStateSchema.parse(state);
      if (result === "controller-conflict") throw new ConflictException({ code: "BOARD_CONTROLLER_CONFLICT", message: "Ein anderes Gerät steuert dieses Board.", details: { currentState: parsed } });
      if (result === "board-unavailable") throw new ConflictException({ code: "BOARD_NOT_AVAILABLE", message: "Das Board ist nicht verfügbar.", details: { currentState: parsed } });
      if (result === "player-busy") throw new ConflictException({ code: "PLAYER_BUSY", message: "Mindestens eine Person spielt bereits an einem anderen Board.", details: { currentState: parsed } });
      return parsed;
    } catch (error) {
      this.rethrowDomainError(error);
    }
  }

  private async require(input: { readonly organizationId: string; readonly auth: Principal }, permission: "match:read" | "match:create" | "match:score" | "match:undo" | "match:abort"): Promise<void> {
    if (isDevicePrincipal(input.auth)) {
      // Fremde Organisation wie bei Personen als unbekannt melden, nicht als verboten.
      if (input.auth.device.organizationId !== input.organizationId) throw new NotFoundException("Match not found.");
      if (!isDevicePermission(permission)) throw new ForbiddenException({ code: "DEVICE_NOT_ALLOWED", message: "Devices may not do this." });
      return;
    }
    await this.access.requirePermission({ organizationId: input.organizationId, userId: input.auth.user.id, permission });
  }

  /** Ein Geraet liest nur Matches seiner Scheibe (Spec 2026-09-30-scheiben-tablet, Abschnitt 3). */
  private requireDeviceMayRead(auth: Principal, state: MatchStateResponse): void {
    if (!isDevicePrincipal(auth)) return;
    const decision = decideDeviceMatchAccess({ action: "read", deviceBoardId: auth.device.boardId, matchBoardId: state.boardId, matchStatus: state.status });
    if (decision === "BOARD_MISMATCH") throw deviceBoardMismatch();
  }

  private rethrowDomainError(error: unknown): never {
    // Die Zuordnung Engine-Code -> HTTP-Status steht in `common/scoring-error.ts`,
    // weil der Turnier-Service dieselbe braucht.
    rethrowScoringError(error);
  }
}
