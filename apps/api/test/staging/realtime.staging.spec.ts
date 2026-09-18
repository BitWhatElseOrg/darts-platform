import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  api,
  createFixtureOrganization,
  readStagingConfig,
  signIn,
  type StagingSession,
} from "./staging-client.js";

const config = readStagingConfig();
const origin = new URL(config.baseUrl).origin;
let session: StagingSession;
let organizationId: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  session = await signIn(config.baseUrl, config.email, config.password, config.origin);
  ({ organizationId } = await createFixtureOrganization(session, `rt-${Date.now()}`));
});

afterAll(() => {
  for (const s of sockets) s.close();
});

describe("Block A – Realtime", () => {
  it("A4: 50 Zuschauer erhalten jedes Ereignis", async () => {
    const players = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        api<{ id: string }>(session, "POST", `/organizations/${organizationId}/players`, {
          displayName: `RT ${n}`,
          status: "ACTIVE",
        }),
      ),
    );
    const board = await api<{ id: string }>(session, "POST", `/organizations/${organizationId}/boards`, {
      name: "RT Board",
    });
    expect(board.status).toBe(201);

    const tournament = await api<{ id: string }>(session, "POST", `/organizations/${organizationId}/tournaments`, {
      name: "Realtime-Test",
      startsAt: new Date().toISOString(),
      format: "SINGLE_ELIMINATION",
      startingScore: 501,
      inRule: "STRAIGHT",
      outRule: "DOUBLE",
      maxRounds: null,
      bestOfLegs: 1,
      bestOfSets: 1,
      participantIds: players.map((p) => p.data.id),
      groupCount: 1,
      qualifyPerGroup: 1,
      knockoutSize: 4,
      seeding: "SEEDED",
      boardIds: [board.data.id],
    });
    expect(tournament.status).toBe(201);

    const visibility = await api(
      session,
      "PATCH",
      `/organizations/${organizationId}/tournaments/${tournament.data.id}/visibility`,
      { visibility: "PUBLIC" },
    );
    expect(visibility.status).toBe(200);

    const dashboard = await api<{
      tournament: { version: number; publicId: string };
      queue: { matchId: string; readiness: string }[];
    }>(session, "GET", `/organizations/${organizationId}/tournaments/${tournament.data.id}/dashboard`);
    const ready = dashboard.data.queue.find((e) => e.readiness === "READY");
    if (!ready) throw new Error("Kein READY-Match im Turnier.");
    const publicId = dashboard.data.tournament.publicId;

    const socketCount = 50;
    const received: number[] = Array.from({ length: socketCount }, () => 0);
    const firstAt: (number | null)[] = Array.from({ length: socketCount }, () => null);

    await Promise.all(
      received.map(
        (_, i) =>
          new Promise<void>((resolve, reject) => {
            const socket = io(origin, { transports: ["websocket"] });
            sockets.push(socket);
            socket.on("connect", () => {
              socket.emit("tournament:subscribe", { publicId });
              resolve();
            });
            socket.on("tournament:changed", () => {
              received[i] = (received[i] ?? 0) + 1;
              if (firstAt[i] === null) firstAt[i] = Date.now();
            });
            socket.on("subscription:rejected", (r: unknown) => reject(new Error(`abgelehnt: ${JSON.stringify(r)}`)));
            socket.on("connect_error", reject);
          }),
      ),
    );

    // `sentAt` misst vor dem Aufruf, nicht danach: der Commit (und damit der
    // Outbox-Eintrag) passiert serverseitig VOR dem Ende der HTTP-Antwort,
    // und der Broadcast lief in einem Testlauf schneller als die
    // HTTP-Antwort zu uns zurueckkam (negative Latenz gemessen ab dem Ende
    // des Requests). Ab Sendezeitpunkt gemessen bleibt die Kennzahl positiv
    // und vergleichbar mit einer "Klick bis Update"-Wahrnehmung.
    const sentAt = Date.now();
    const assign = await api(
      session,
      "POST",
      `/organizations/${organizationId}/tournaments/${tournament.data.id}/assignments`,
      {
        commandId: randomUUID(),
        expectedVersion: dashboard.data.tournament.version,
        matchId: ready.matchId,
        boardId: board.data.id,
      },
    );
    expect(assign.status).toBe(201);

    // Das Relay veroeffentlicht die Outbox alle 500 ms; 5 s Wartezeit lassen
    // reichlich Spielraum fuer den langsamsten Socket.
    await new Promise((resolve) => setTimeout(resolve, 5_000));

    const missing = received.filter((count) => count === 0).length;
    const latencies = firstAt
      .filter((t): t is number => t !== null)
      .map((t) => t - sentAt)
      .sort((a, b) => a - b);
    const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? -1;

    const result = {
      case: "A4",
      at: new Date().toISOString(),
      sockets: socketCount,
      missing,
      p50: latencies[Math.floor(latencies.length * 0.5)] ?? -1,
      p95,
      maxMs: latencies.at(-1) ?? -1,
    };
    const outDir = path.resolve(import.meta.dirname, "../../../../docs/testing/protokolle/messwerte");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, `${result.at.slice(0, 10)}-a4.json`), JSON.stringify(result, null, 2));

    expect(missing, `${missing} von ${socketCount} Sockets ohne Ereignis nach ${Date.now() - sentAt} ms`).toBe(0);
    expect(p95).toBeLessThan(2_000);
  });
});
