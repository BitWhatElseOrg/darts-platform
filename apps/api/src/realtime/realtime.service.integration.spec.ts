import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { io, type Socket } from "socket.io-client";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { organizations, tournaments } from "@darts-platform/database";

import { DatabaseService } from "../database/database.service.js";
import { createApiTestApplication } from "../testing/api-harness.js";
import { RealtimeService } from "./realtime.service.js";

/**
 * Regressionswache fuer genau die Luecke, die dieses Programm (I-2) schliesst:
 * ein Socket ohne Berechtigung darf einem Raum weder beitreten noch je ein
 * Ereignis daraus empfangen. `subscription-authorization.integration.spec.ts`
 * deckt die Entscheidungslogik selbst bereits erschoepfend ab (echte Sitzung,
 * echter Anzeige-Schluessel); dieser Test prueft nur, dass die Verdrahtung in
 * `RealtimeService.register` real steht — ueber einen echten HTTP-Server mit
 * echtem Socket.IO, nicht gegen die Kollaboratoren direkt. Ohne ihn wuerde
 * nichts fehlschlagen, wenn der Autorisierungsaufruf aus `RealtimeService`
 * versehentlich entfernt wuerde.
 */
const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);

const organizationId = randomUUID();
let privateTournamentPublicId: string;
let app: NestFastifyApplication;
let baseUrl: string;

beforeAll(async () => {
  await databaseService.database.insert(organizations).values({
    id: organizationId,
    name: "Kanal-Autorisierung Steckdose",
    slug: `realtime-wire-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  const [tournament] = await databaseService.database
    .insert(tournaments)
    .values({
      organizationId,
      visibility: "PRIVATE",
      name: `Kanal-Autorisierung Steckdose ${randomUUID()}`,
      format: "SINGLE_ELIMINATION",
      groupCount: 1,
      qualifyPerGroup: 1,
      knockoutSize: 2,
      seeding: "RANDOM",
      startsAt: new Date("2026-09-20T18:00:00.000Z"),
    })
    .returning();
  if (tournament === undefined) throw new Error("Turnier wurde nicht angelegt.");
  privateTournamentPublicId = tournament.publicId;

  app = await createApiTestApplication();
  await app.listen(0, "127.0.0.1");
  await app.get(RealtimeService).attach(app.getHttpServer());
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(async () => {
  await app.close();
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.onApplicationShutdown();
});

describe("RealtimeService ueber die reale Socket.IO-Schicht", () => {
  it("weist ein privates Turnier ohne Berechtigung ab und liefert danach keine Ereignisse mehr", async () => {
    const socket: Socket = io(baseUrl, { withCredentials: true, transports: ["websocket"] });
    try {
      const rejected = await new Promise<{ readonly room: string; readonly reason: string }>(
        (resolve, reject) => {
          socket.on("connect", () => {
            socket.emit("tournament:subscribe", { publicId: privateTournamentPublicId });
          });
          socket.on("subscription:rejected", (payload: { room: string; reason: string }) =>
            resolve(payload),
          );
          socket.on("connect_error", reject);
          setTimeout(
            () => reject(new Error("Zeitueberschreitung beim Warten auf subscription:rejected")),
            5_000,
          );
        },
      );

      expect(rejected).toEqual({
        room: `tournament:${privateTournamentPublicId}`,
        reason: "SUBSCRIPTION_FORBIDDEN",
      });

      // Ob der Beitritt tatsaechlich unterblieben ist: ein Ereignis, das die
      // App direkt ueber den Broadcaster in genau diesen Raum schickt, darf
      // diesen Socket nicht erreichen.
      let changed = false;
      socket.on("tournament:changed", () => {
        changed = true;
      });
      app.get(RealtimeService).emit(`tournament:${privateTournamentPublicId}`, "tournament:changed", {
        eventId: randomUUID(),
        eventType: "tournament.updated",
        occurredAt: new Date().toISOString(),
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(changed).toBe(false);
    } finally {
      socket.disconnect();
    }
  });
});
