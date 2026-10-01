import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, lt, or } from "drizzle-orm";

import { boardDevices } from "@darts-platform/database";
import { hashBoardDeviceSecret } from "@darts-platform/domain/board-device-secret";

import { DatabaseService } from "../database/database.service.js";
import type { AuthenticatedDevice } from "./auth.types.js";

const LAST_SEEN_RESOLUTION_MS = 60_000;
const CLASSIFY_CACHE_MS = 30_000;

@Injectable()
export class BoardDeviceAuthenticator {
  private readonly classified = new Map<string, { readonly deviceId: string | null; readonly until: number }>();

  public constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  /**
   * Frisch gegen die Datenbank, damit ein Widerruf mit der naechsten Anfrage
   * wirkt.
   *
   * Abschlussreview-Befund 3 (final-fix-findings.md): `lastSeenAt` steht
   * schon in diesem SELECT, damit das anschliessende UPDATE nur noch
   * abgesetzt wird, wenn es wirklich noetig ist (noch nie gesehen oder
   * laenger als `LAST_SEEN_RESOLUTION_MS` her) -- vorher lief bei jeder
   * Anfrage (Wurf, Heartbeat, Poll) ein SELECT **und** ein UPDATE, auch
   * innerhalb derselben Minute, in der das UPDATE ohnehin nichts geaendert
   * haette.
   */
  public async authenticate(secret: string): Promise<AuthenticatedDevice | null> {
    const secretHash = hashBoardDeviceSecret(secret);
    const [device] = await this.databaseService.database
      .select({
        id: boardDevices.id,
        organizationId: boardDevices.organizationId,
        boardId: boardDevices.boardId,
        lastSeenAt: boardDevices.lastSeenAt,
      })
      .from(boardDevices)
      .where(and(eq(boardDevices.secretHash, secretHash), isNull(boardDevices.revokedAt)))
      .limit(1);
    if (device === undefined) return null;
    const lastSeenStale =
      device.lastSeenAt === null || device.lastSeenAt.getTime() < Date.now() - LAST_SEEN_RESOLUTION_MS;
    if (lastSeenStale) {
      // Hoechstens ein Schreibzugriff pro Minute, nicht einer pro Wurf. Die
      // Bedingung im WHERE bleibt als zweite Absicherung gegen ein knappes
      // Rennen mit einer parallelen Anfrage desselben Geraets stehen -- der
      // obige Lesewert kann in dem Moment schon wieder veraltet sein.
      await this.databaseService.database
        .update(boardDevices)
        .set({ lastSeenAt: new Date() })
        .where(and(
          eq(boardDevices.id, device.id),
          or(isNull(boardDevices.lastSeenAt), lt(boardDevices.lastSeenAt, new Date(Date.now() - LAST_SEEN_RESOLUTION_MS))),
        ));
    }
    return { id: device.id, organizationId: device.organizationId, boardId: device.boardId };
  }

  /**
   * Nur fuer die Einordnung im Rate-Limit, das vor dem Guard laeuft. Gecacht,
   * weil sonst jede Anfrage zwei Nachschlaege kostete; ein Widerruf wird hier
   * bis zu 30 s spaeter sichtbar, wirkt im Guard aber sofort.
   */
  public async classify(secret: string): Promise<string | null> {
    const now = Date.now();
    // Schluessel ist der Hash, nie der Klartext.
    const secretHash = hashBoardDeviceSecret(secret);
    const cached = this.classified.get(secretHash);
    if (cached !== undefined && cached.until > now) return cached.deviceId;
    const [device] = await this.databaseService.database
      .select({ id: boardDevices.id })
      .from(boardDevices)
      .where(and(eq(boardDevices.secretHash, secretHash), isNull(boardDevices.revokedAt)))
      .limit(1);
    const deviceId = device?.id ?? null;
    if (this.classified.size > 10_000) this.classified.clear();
    this.classified.set(secretHash, { deviceId, until: now + CLASSIFY_CACHE_MS });
    return deviceId;
  }
}
