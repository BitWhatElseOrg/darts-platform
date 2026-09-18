import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { matchStateSchema } from "@darts-platform/schemas";

import { api, createFixtureOrganization, createMatch, readStagingConfig, signIn, visit, type StagingSession } from "./staging-client.js";

const config = readStagingConfig();
let session: StagingSession;
let organizationId: string;
let playerIds: [string, string];

beforeAll(async () => {
  session = await signIn(config.baseUrl, config.email, config.password, config.origin);
  ({ organizationId, playerIds } = await createFixtureOrganization(session, `conc-${Date.now()}`));
});

describe("Block A – Nebenläufigkeit", () => {
  it("A1: zwei Scorer mit derselben expectedVersion – genau einer gewinnt", async () => {
    const match = await createMatch(session, organizationId, playerIds, null);
    const path = `/organizations/${organizationId}/matches/${match.id}/visits`;
    const [a, b] = await Promise.all([
      api(session, "POST", path, visit(playerIds[0], 0, 60)),
      api(session, "POST", path, visit(playerIds[0], 0, 45)),
    ]);
    // NestJS liefert fuer POST ohne @HttpCode() standardmaessig 201, nicht
    // 200 (kein Ueberschreiben in matches.controller.ts); die Erwartung ist
    // dem tatsaechlichen Vertrag angepasst, das Konfliktverhalten selbst nicht.
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = a.status === 409 ? a : b;
    expect((conflict.data as { error: { code: string } }).error.code).toBe("MATCH_VERSION_CONFLICT");
    const state = await api(session, "GET", `/organizations/${organizationId}/matches/${match.id}`, undefined, matchStateSchema);
    expect(state.data.version).toBe(1);
    expect(state.data.visits).toHaveLength(1);
  });

  it("A2: dieselbe commandId zehnmal parallel – ein Visit", async () => {
    const match = await createMatch(session, organizationId, playerIds, null);
    const path = `/organizations/${organizationId}/matches/${match.id}/visits`;
    const command = visit(playerIds[0], 0, 100);
    const results = await Promise.all(Array.from({ length: 10 }, () => api(session, "POST", path, command, matchStateSchema)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.data.version))).toEqual(new Set([1]));
    expect(results[0]!.data.visits).toHaveLength(1);
  });

  it("A6: Undo während laufender Visits bleibt konsistent", async () => {
    const match = await createMatch(session, organizationId, playerIds, null);
    const base = `/organizations/${organizationId}/matches/${match.id}`;
    let version = 0;
    // Der aktive Spieler ist Zustand, nicht `version % 2`: die Reihenfolge
    // haengt vom Anwurf ab (Reglement 2.2.9), nicht davon, dass Spieler 1
    // grundsaetzlich mit gerader Version wirft. Wir lesen ihn deshalb nach
    // jedem Visit aus `participants[].isActive` statt ihn anzunehmen.
    let activePlayerId = match.participants.find((p) => p.isActive)?.playerId ?? playerIds[0];
    for (const points of [60, 60, 60]) {
      const r = await api(session, "POST", `${base}/visits`, visit(activePlayerId, version, points), matchStateSchema);
      expect(r.status).toBe(201);
      version = r.data.version;
      activePlayerId = r.data.participants.find((p) => p.isActive)?.playerId ?? activePlayerId;
    }
    const [undo, nextVisit] = await Promise.all([
      api(session, "POST", `${base}/undo`, { commandId: randomUUID(), expectedVersion: version }),
      api(session, "POST", `${base}/visits`, visit(activePlayerId, version, 41)),
    ]);
    expect([undo.status, nextVisit.status].sort()).toEqual([201, 409]);
    const state = await api(session, "GET", base, undefined, matchStateSchema);
    expect(state.data.version).toBe(version + 1);
    // Entweder wurde rueckgaengig gemacht (2 aktive Visits) oder geworfen (4): nie beides.
    const active = state.data.visits.filter((v) => !v.reverted).length;
    expect([2, 4]).toContain(active);
  });
});
