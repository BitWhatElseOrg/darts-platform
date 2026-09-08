import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import {
  createDisplayKeySecret,
  decideDisplayKeyState,
  hashDisplayKeySecret,
  type DisplayKeyState,
} from "@darts-platform/domain";
import {
  createdDisplayKeySchema,
  displayKeyListSchema,
  type CreateDisplayKeyInput,
  type CreatedDisplayKey,
  type DisplayKeyList,
} from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { DisplayKeysRepository } from "./display-keys.repository.js";
import { TournamentsRepository } from "./tournaments.repository.js";

/**
 * Ein Turnier laeuft ueber den Abend hinaus oder geht am Folgetag weiter; der
 * Zugang soll nicht mitten im Betrieb sterben. Ohne Angabe gilt darum
 * Turnierbeginn plus 48 Stunden als Vorgabe fuer `expiresAt`.
 */
const DEFAULT_EXPIRY_OFFSET_MS = 48 * 60 * 60 * 1000;

@Injectable()
export class DisplayKeysService {
  public constructor(
    @Inject(DisplayKeysRepository) private readonly repository: DisplayKeysRepository,
    @Inject(TournamentsRepository) private readonly tournaments: TournamentsRepository,
    @Inject(OrganizationAccessService) private readonly access: OrganizationAccessService,
  ) {}

  public async create(input: {
    readonly organizationId: string;
    readonly tournamentId: string;
    readonly data: CreateDisplayKeyInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<CreatedDisplayKey> {
    await this.requireShare(input);
    const tournament = await this.repository.getTournamentStartsAt(
      input.organizationId,
      input.tournamentId,
    );
    if (tournament === null) throw new NotFoundException("Tournament not found.");

    const secret = createDisplayKeySecret();
    const expiresAt =
      input.data.expiresAt ?? new Date(tournament.startsAt.getTime() + DEFAULT_EXPIRY_OFFSET_MS);
    const created = await this.repository.insert({
      organizationId: input.organizationId,
      tournamentId: input.tournamentId,
      label: input.data.label,
      expiresAt,
      secretHash: hashDisplayKeySecret(secret),
      createdBy: input.auth.user.id,
      auth: input.auth,
      audit: input.audit,
    });
    return createdDisplayKeySchema.parse({
      id: created.id,
      label: created.label,
      expiresAt: created.expiresAt,
      revokedAt: created.revokedAt,
      state: decideDisplayKeyState({
        expiresAt: created.expiresAt,
        revokedAt: created.revokedAt,
        now: new Date(),
      }),
      // Der Klartext existiert ausschliesslich hier, in genau dieser Antwort.
      secret,
    });
  }

  public async list(input: {
    readonly organizationId: string;
    readonly tournamentId: string;
    readonly auth: AuthContext;
  }): Promise<DisplayKeyList> {
    await this.requireShare(input);
    const rows = await this.repository.listByTournament(input.organizationId, input.tournamentId);
    const now = new Date();
    return displayKeyListSchema.parse({
      keys: rows.map((row) => ({
        id: row.id,
        label: row.label,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        state: decideDisplayKeyState({ expiresAt: row.expiresAt, revokedAt: row.revokedAt, now }),
      })),
    });
  }

  public async revoke(input: {
    readonly organizationId: string;
    readonly tournamentId: string;
    readonly keyId: string;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<void> {
    await this.requireShare(input);
    const result = await this.repository.markRevoked(input);
    if (result === "not-found") throw new NotFoundException("Display key not found.");
  }

  /**
   * Nimmt den Klartext aus der Adresse und beantwortet genau eine Frage: darf
   * dieser Schluessel dieses Turnier sehen? Alles Uebrige — abgelaufen,
   * widerrufen, fremdes Turnier, gar nicht vorhanden — faellt zu `invalid`
   * zusammen. Der Aufrufer antwortet in allen Faellen mit 404; eine feinere
   * Auskunft waere eine Auskunft ueber fremde Turniere.
   */
  public async resolve(publicId: string, secret: string): Promise<"valid" | "invalid"> {
    const row = await this.repository.findBySecretHash(hashDisplayKeySecret(secret));
    if (row === null) return "invalid";
    if (decideDisplayKeyState({ ...row, now: new Date() }) !== "valid") return "invalid";
    const tournament = await this.tournaments.getAccessFactsByPublicId(publicId);
    return tournament !== null && tournament.id === row.tournamentId ? "valid" : "invalid";
  }

  /**
   * Dieselbe Pruefung, aber mit dem Zustand statt einem Ja/Nein. Plan 3
   * braucht ihn, weil `decideSubscription` zwischen abgelaufen und widerrufen
   * unterscheidet; `resolve` faltet beides zu `invalid` zusammen und ruft
   * diese Funktion auf, statt die Pruefung ein zweites Mal zu schreiben.
   */
  public async stateOf(tournamentId: string, secret: string): Promise<DisplayKeyState | "absent"> {
    const row = await this.repository.findBySecretHash(hashDisplayKeySecret(secret));
    if (row === null || row.tournamentId !== tournamentId) return "absent";
    return decideDisplayKeyState({ ...row, now: new Date() });
  }

  private async requireShare(input: {
    readonly organizationId: string;
    readonly auth: AuthContext;
  }): Promise<void> {
    await this.access.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission: "tournament:share",
    });
  }
}
