import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";

import {
  auditEvents,
  tournamentDisplayKeys,
  tournaments,
  type TournamentDisplayKey,
} from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";

export type DisplayKeyMutationResult = "ok" | "not-found";

@Injectable()
export class DisplayKeysRepository {
  public constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  /**
   * Tenant-sichere Randbedingung fuer `create`: liefert den Turnierbeginn, aus
   * dem die Vorgabe fuer `expiresAt` folgt, und bestaetigt zugleich, dass das
   * Turnier zu dieser Organisation gehoert. Ein `null` bedeutet fuer den
   * Aufrufer „kein solches Turnier in dieser Organisation" (AGENTS.md §14).
   */
  public async getTournamentStartsAt(
    organizationId: string,
    tournamentId: string,
  ): Promise<{ readonly startsAt: Date } | null> {
    const [row] = await this.databaseService.database
      .select({ startsAt: tournaments.startsAt })
      .from(tournaments)
      .where(and(eq(tournaments.organizationId, organizationId), eq(tournaments.id, tournamentId)))
      .limit(1);
    return row ?? null;
  }

  public async insert(input: {
    readonly organizationId: string;
    readonly tournamentId: string;
    readonly label: string;
    readonly expiresAt: Date;
    readonly secretHash: string;
    readonly createdBy: string;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<TournamentDisplayKey> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(tournamentDisplayKeys)
        .values({
          organizationId: input.organizationId,
          tournamentId: input.tournamentId,
          label: input.label,
          expiresAt: input.expiresAt,
          secretHash: input.secretHash,
          createdBy: input.createdBy,
        })
        .returning();
      if (created === undefined) throw new Error("Display key insert did not return a row.");
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.auth.user.id,
        action: "TOURNAMENT_DISPLAY_KEY_ISSUED",
        entityType: "TournamentDisplayKey",
        entityId: created.id,
        oldValue: null,
        newValue: { label: created.label, expiresAt: created.expiresAt },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return created;
    });
  }

  public async listByTournament(
    organizationId: string,
    tournamentId: string,
  ): Promise<TournamentDisplayKey[]> {
    return this.databaseService.database
      .select()
      .from(tournamentDisplayKeys)
      .where(
        and(
          eq(tournamentDisplayKeys.organizationId, organizationId),
          eq(tournamentDisplayKeys.tournamentId, tournamentId),
        ),
      )
      .orderBy(asc(tournamentDisplayKeys.createdAt));
  }

  public async markRevoked(input: {
    readonly organizationId: string;
    readonly tournamentId: string;
    readonly keyId: string;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<DisplayKeyMutationResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(tournamentDisplayKeys)
        .where(
          and(
            eq(tournamentDisplayKeys.organizationId, input.organizationId),
            eq(tournamentDisplayKeys.tournamentId, input.tournamentId),
            eq(tournamentDisplayKeys.id, input.keyId),
          ),
        )
        .for("update")
        .limit(1);
      if (existing === undefined) return "not-found";
      // Ein bereits widerrufener Schluessel bleibt widerrufen — ein zweiter
      // Widerruf ist ein Leerlauf, keine zweite Aenderung, und erzeugt darum
      // keinen zweiten Audit-Satz.
      if (existing.revokedAt !== null) return "ok";
      const revokedAt = new Date();
      await transaction
        .update(tournamentDisplayKeys)
        .set({ revokedAt, updatedAt: revokedAt })
        .where(
          and(
            eq(tournamentDisplayKeys.organizationId, input.organizationId),
            eq(tournamentDisplayKeys.id, input.keyId),
          ),
        );
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.auth.user.id,
        action: "TOURNAMENT_DISPLAY_KEY_REVOKED",
        entityType: "TournamentDisplayKey",
        entityId: existing.id,
        oldValue: { revokedAt: null },
        newValue: { revokedAt },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return "ok";
    });
  }

  /**
   * Nachschlag ueber den Unique-Index auf `secret_hash` — nicht ueber alle
   * Schluessel eines Turniers, die dann einzeln verglichen wuerden. Die
   * Turnierzugehoerigkeit prueft der Aufrufer gegen den Treffer; so gibt es
   * genau eine Abfrage, egal wie viele Schluessel existieren.
   */
  public async findBySecretHash(secretHash: string): Promise<{
    readonly tournamentId: string;
    readonly expiresAt: Date;
    readonly revokedAt: Date | null;
  } | null> {
    const [row] = await this.databaseService.database
      .select({
        tournamentId: tournamentDisplayKeys.tournamentId,
        expiresAt: tournamentDisplayKeys.expiresAt,
        revokedAt: tournamentDisplayKeys.revokedAt,
      })
      .from(tournamentDisplayKeys)
      .where(eq(tournamentDisplayKeys.secretHash, secretHash))
      .limit(1);
    return row ?? null;
  }
}
