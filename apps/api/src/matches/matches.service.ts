import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ScoringValidationError } from "@darts-platform/scoring-engine";
import { abortMatchResponseSchema, boardControllerLeaseSchema, matchListSchema, matchStateSchema, type AbortMatchInput, type AbortMatchResponse, type BoardControllerLeaseResponse, type CreateMatchInput, type DecideLegByBullInput, type DecideLegStartInput, type MatchStateResponse, type SubmitVisitInput, type UndoVisitInput } from "@darts-platform/schemas";
import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { MatchesRepository, type UndoMutationResult } from "./matches.repository.js";

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

  public async get(input: { readonly organizationId: string; readonly matchId: string; readonly auth: AuthContext }): Promise<MatchStateResponse> {
    await this.require(input, "match:read");
    const state = await this.repository.getState(input.organizationId, input.matchId);
    if (state === null) throw new NotFoundException("Match not found.");
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

  public async submitVisit(input: { readonly organizationId: string; readonly matchId: string; readonly data: SubmitVisitInput; readonly auth: AuthContext; readonly audit: AuditContext }): Promise<MatchStateResponse> {
    await this.require(input, "match:score");
    return this.mutate(input, () => this.repository.submitVisit(input));
  }

  public async undo(input: { readonly organizationId: string; readonly matchId: string; readonly data: UndoVisitInput; readonly auth: AuthContext; readonly audit: AuditContext }): Promise<MatchStateResponse> {
    await this.require(input, "match:undo");
    return this.mutate(input, () => this.repository.undo(input));
  }

  public async decideLegStart(input: { readonly organizationId: string; readonly matchId: string; readonly data: DecideLegStartInput; readonly auth: AuthContext; readonly audit: AuditContext }): Promise<MatchStateResponse> {
    await this.require(input, "match:score");
    return this.mutate(input, () => this.repository.decideLegStart(input));
  }

  public async decideLegByBull(input: { readonly organizationId: string; readonly matchId: string; readonly data: DecideLegByBullInput; readonly auth: AuthContext; readonly audit: AuditContext }): Promise<MatchStateResponse> {
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

  public async acquireControllerLease(input: { readonly organizationId: string; readonly matchId: string; readonly controllerId: string; readonly force: boolean; readonly auth: AuthContext; readonly audit: AuditContext }): Promise<BoardControllerLeaseResponse> {
    await this.require(input, "match:score");
    const lease = await this.repository.acquireControllerLease(input);
    if (lease === null) throw new NotFoundException("Match not found.");
    return boardControllerLeaseSchema.parse(lease);
  }

  private async mutate(input: { readonly organizationId: string; readonly matchId: string }, mutation: () => Promise<UndoMutationResult>): Promise<MatchStateResponse> {
    try {
      const result = await mutation();
      if (result === "not-found") throw new NotFoundException("Match not found.");
      const state = await this.repository.getState(input.organizationId, input.matchId);
      if (result === "version-conflict") throw new MatchVersionConflictException(state === null ? null : matchStateSchema.parse(state));
      if (state === null) throw new NotFoundException("Match not found.");
      const parsed = matchStateSchema.parse(state);
      if (result === "controller-conflict") throw new ConflictException({ code: "BOARD_CONTROLLER_CONFLICT", message: "Ein anderes Gerät steuert dieses Board.", details: { currentState: parsed } });
      if (result === "board-unavailable") throw new ConflictException({ code: "BOARD_NOT_AVAILABLE", message: "Das Board ist nicht verfügbar.", details: { currentState: parsed } });
      return parsed;
    } catch (error) {
      this.rethrowDomainError(error);
    }
  }

  private async require(input: { readonly organizationId: string; readonly auth: AuthContext }, permission: "match:read" | "match:create" | "match:score" | "match:undo" | "match:abort"): Promise<void> {
    await this.access.requirePermission({ organizationId: input.organizationId, userId: input.auth.user.id, permission });
  }

  private rethrowDomainError(error: unknown): never {
    if (error instanceof ScoringValidationError) {
      // Ein zu frühes Ausbullen ist kein Eingabefehler, sondern ein Zustand:
      // die Rundengrenze ist schlicht noch nicht erreicht.
      // Eine belegte Scheibe ist ebenso wenig ein Eingabefehler: die Anfrage
      // ist gueltig, der Zustand steht ihr entgegen.
      if (error.code === "ROUND_LIMIT_NOT_REACHED" || error.code === "BOARD_NOT_AVAILABLE") {
        throw new ConflictException({ code: error.code, message: error.message });
      }
      throw new BadRequestException({ code: error.code, message: error.message });
    }
    throw error;
  }
}
