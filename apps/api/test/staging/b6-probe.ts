// Block B6 (Betriebsprobe, kein Spec): API-Neustart mit 50 offenen Sockets.
// Ablauf: oeffentliches Turnier anlegen, 50 Sockets abonnieren, `railway restart`
// der Staging-API, warten bis alle Sockets neu verbunden sind, dann ein Ereignis
// ausloesen und zaehlen, wie viele Sockets es empfangen. Aufruf aus apps/api:
//   npx dotenv -e ../../.env.staging -- npx tsx test/staging/b6-probe.ts
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { io, type Socket } from "socket.io-client";

import { api, createFixtureOrganization, readStagingConfig, signIn } from "./staging-client.js";

const PROJECT = "b72b141e-1685-44d7-960e-06c6b3998b34";
const SOCKETS = 50;
const config = readStagingConfig();
const origin = new URL(config.baseUrl).origin;
const log = (message: string): void => console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);

const session = await signIn(config.baseUrl, config.email, config.password, config.origin);
const { organizationId } = await createFixtureOrganization(session, `b6-${Date.now()}`);
const players = await Promise.all(
  [1, 2, 3, 4].map((n) =>
    api<{ id: string }>(session, "POST", `/organizations/${organizationId}/players`, { displayName: `B6 ${n}`, status: "ACTIVE" }),
  ),
);
const board = await api<{ id: string }>(session, "POST", `/organizations/${organizationId}/boards`, { name: "B6 Board" });
const tournament = await api<{ id: string }>(session, "POST", `/organizations/${organizationId}/tournaments`, {
  name: "B6 API-Neustart", startsAt: new Date().toISOString(), format: "SINGLE_ELIMINATION",
  startingScore: 501, inRule: "STRAIGHT", outRule: "DOUBLE", maxRounds: null, bestOfLegs: 1, bestOfSets: 1,
  participantIds: players.map((p) => p.data.id), groupCount: 1, qualifyPerGroup: 1, knockoutSize: 4,
  seeding: "SEEDED", boardIds: [board.data.id],
});
if (tournament.status !== 201) throw new Error(`Turnier nicht angelegt: ${tournament.status}`);
await api(session, "PATCH", `/organizations/${organizationId}/tournaments/${tournament.data.id}/visibility`, { visibility: "PUBLIC" });
const dashboard = await api<{ tournament: { version: number; publicId: string }; queue: { matchId: string; readiness: string }[] }>(
  session, "GET", `/organizations/${organizationId}/tournaments/${tournament.data.id}/dashboard`);
const ready = dashboard.data.queue.find((e) => e.readiness === "READY");
if (!ready) throw new Error("Kein READY-Match.");
const publicId = dashboard.data.tournament.publicId;

const sockets: Socket[] = [];
const connects: number[] = Array.from({ length: SOCKETS }, () => 0);
const received: number[] = Array.from({ length: SOCKETS }, () => 0);
await Promise.all(
  connects.map((_, i) => new Promise<void>((resolve, reject) => {
    const socket = io(origin, { transports: ["websocket"], reconnectionDelay: 500, reconnectionDelayMax: 2000 });
    sockets.push(socket);
    socket.on("connect", () => {
      connects[i] = (connects[i] ?? 0) + 1;
      // Nach jedem (Neu-)Verbinden erneut abonnieren – so macht es auch der Web-Client.
      socket.emit("tournament:subscribe", { publicId });
      resolve();
    });
    socket.on("tournament:changed", () => { received[i] = (received[i] ?? 0) + 1; });
    socket.on("subscription:rejected", (r: unknown) => reject(new Error(`abgelehnt: ${JSON.stringify(r)}`)));
    socket.on("connect_error", reject);
  })),
);
log(`${SOCKETS} Sockets verbunden und abonniert`);

log("API-Neustart ausloesen");
const restartedAt = Date.now();
execFileSync("railway", ["restart", "--project", PROJECT, "--environment", "staging", "--service", "@darts-platform/api", "--yes", "--json"], { stdio: "ignore", timeout: 60_000 });

// Warten, bis jeder Socket mindestens einmal neu verbunden ist (connect-Zaehler >= 2), maximal 90 s.
const deadline = Date.now() + 90_000;
while (Date.now() < deadline && connects.some((c) => c < 2)) await new Promise((r) => setTimeout(r, 500));
const reconnected = connects.filter((c) => c >= 2).length;
log(`${reconnected}/${SOCKETS} Sockets neu verbunden nach ${Math.round((Date.now() - restartedAt) / 1000)} s`);
await new Promise((r) => setTimeout(r, 3_000));

// Ereignis ausloesen (Board-Zuordnung) und Zustellung zaehlen.
const fresh = await api<{ tournament: { version: number } }>(session, "GET", `/organizations/${organizationId}/tournaments/${tournament.data.id}/dashboard`);
const sentAt = Date.now();
const assign = await api(session, "POST", `/organizations/${organizationId}/tournaments/${tournament.data.id}/assignments`, {
  commandId: randomUUID(), expectedVersion: fresh.data.tournament.version, matchId: ready.matchId, boardId: board.data.id,
});
log(`Zuordnung: HTTP ${assign.status}`);
await new Promise((r) => setTimeout(r, 6_000));
const missing = received.filter((c) => c === 0).length;
log(`Ereignis empfangen: ${SOCKETS - missing}/${SOCKETS} Sockets (Wartezeit ${Math.round((Date.now() - sentAt) / 1000)} s)`);
for (const s of sockets) s.close();
console.log(JSON.stringify({ case: "B6", at: new Date().toISOString(), sockets: SOCKETS, reconnected, missing, assignStatus: assign.status }));
process.exit(missing === 0 && reconnected === SOCKETS ? 0 : 1);
