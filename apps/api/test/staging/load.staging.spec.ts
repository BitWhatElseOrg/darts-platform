import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { matchStateSchema, type MatchStateResponse } from "@darts-platform/schemas";

import {
  api,
  createFixtureOrganization,
  createMatch,
  readStagingConfig,
  signIn,
  visit,
  type StagingSession,
} from "./staging-client.js";

const config = readStagingConfig();
let session: StagingSession;
let organizationId: string;

beforeAll(async () => {
  session = await signIn(config.baseUrl, config.email, config.password, config.origin);
  ({ organizationId } = await createFixtureOrganization(session, `load-${Date.now()}`));
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requirePositiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} muss eine positive Zahl sein, war: ${JSON.stringify(process.env[name] ?? value)}.`);
  }
  return value;
}

/**
 * Konfigurierbar fuer einen kurzen Smoke-Lauf (`STAGING_LOAD_BOARDS`,
 * `STAGING_LOAD_SECONDS`); die Vorlage (Aufgabe 10) nennt 20 Boards ueber
 * 120 Sekunden als vollen Lauf.
 */
const BOARDS = requirePositiveNumber(Number(process.env.STAGING_LOAD_BOARDS ?? 20), "STAGING_LOAD_BOARDS");
const DURATION_MS =
  requirePositiveNumber(Number(process.env.STAGING_LOAD_SECONDS ?? 120), "STAGING_LOAD_SECONDS") * 1000;
const VISIT_INTERVAL_MS = 333; // Ziel-Taktung: ~3 Visits/Sekunde je Match

describe("Block A – Last", () => {
  it(
    `A3: ${BOARDS} Matches, angestrebt 3 Visits pro Sekunde je Match, ${DURATION_MS / 1000} Sekunden`,
    async () => {
      const latencies: number[] = [];
      let errors = 0;
      let completedMatches = 0;

      const boards = await Promise.all(
        Array.from({ length: BOARDS }, async (_, i) => {
          const players = await Promise.all(
            [1, 2].map((n) =>
              api<{ id: string }>(session, "POST", `/organizations/${organizationId}/players`, {
                displayName: `L${i}-${n}`,
                status: "ACTIVE",
              }),
            ),
          );
          const playerIds: [string, string] = [players[0]!.data.id, players[1]!.data.id];
          const match = await createMatch(session, organizationId, playerIds, null);
          return { playerIds, match };
        }),
      );

      const endAt = Date.now() + DURATION_MS;
      const points = 26; // haelt das Leg lange offen (501 / 26 ist nicht ganzzahlig)

      await Promise.all(
        boards.map(async ({ playerIds, match }) => {
          let current: MatchStateResponse = match;
          let activePlayerId =
            current.participants.find((p) => p.isActive)?.playerId ?? playerIds[0];

          while (Date.now() < endAt) {
            const started = performance.now();
            try {
              const r = await api(
                session,
                "POST",
                `/organizations/${organizationId}/matches/${current.id}/visits`,
                visit(activePlayerId, current.version, points),
                matchStateSchema,
              );
              latencies.push(performance.now() - started);
              if (r.status !== 201) {
                errors += 1;
                break;
              }
              current = r.data;
              if (current.status === "COMPLETED") {
                // 501 / 26 geht nicht auf: unter den festen 26-Punkte-Aufnahmen
                // bustet das Leg statt zu enden. Sollte es dennoch enden
                // (z. B. durch eine abweichende Serverentscheidung), macht ein
                // frisches Match auf demselben "Board" weiter, statt den Lauf
                // abzubrechen.
                completedMatches += 1;
                current = await createMatch(session, organizationId, playerIds, null);
                activePlayerId =
                  current.participants.find((p) => p.isActive)?.playerId ?? playerIds[0];
              } else {
                activePlayerId =
                  current.participants.find((p) => p.isActive)?.playerId ?? activePlayerId;
              }
            } catch {
              latencies.push(performance.now() - started);
              errors += 1;
              break;
            }
            // Feste Taktung auf den Intervall-START, nicht auf das ENDE der
            // Antwort: eine feste Pause NACH jeder Antwort haette die
            // Antwortzeit selbst mit aufsummiert und die tatsaechliche Rate
            // je nach Latenz unter das Ziel gedrueckt (siehe Protokoll:
            // vorherige Laeufe erreichten dadurch nur ~1,7-2,5 statt der
            // angestrebten 3 Visits/s).
            await sleep(Math.max(0, VISIT_INTERVAL_MS - (performance.now() - started)));
          }
        }),
      );

      const result = {
        case: "A3",
        at: new Date().toISOString(),
        boards: BOARDS,
        durationMs: DURATION_MS,
        requests: latencies.length,
        errors,
        completedMatches,
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99),
      };

      const outDir = path.resolve(import.meta.dirname, "../../../../docs/testing/protokolle/messwerte");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, `${result.at.slice(0, 10)}-a3.json`), JSON.stringify(result, null, 2));

      // Mindestlast: ohne diese Schranke wuerde A3 auch gruen laufen, wenn
      // ueberhaupt keine Anfrage rausging (z. B. weil BOARDS oder
      // DURATION_MS versehentlich 0 waeren) -- mindestens ein Visit pro
      // Board und Sekunde.
      expect(result.requests).toBeGreaterThan(BOARDS * (DURATION_MS / 1000));
      expect(errors).toBe(0);
      expect(result.p95).toBeLessThan(500);
    },
    Math.max(DURATION_MS + 60_000, 180_000),
  );

  it("A5: 600 öffentliche Anfragen pro Minute bleiben frei, 700 erzeugen 429 ohne andere Routen zu bremsen", async () => {
    const publicId = "00000000-0000-4000-8000-000000000000";
    const total = 700;
    const batchSize = 50;
    const statuses: number[] = [];

    for (let sent = 0; sent < total; sent += batchSize) {
      const count = Math.min(batchSize, total - sent);
      const batch = await Promise.all(
        Array.from({ length: count }, () =>
          fetch(`${config.baseUrl}/public/tournaments/${publicId}/live`)
            .then((r) => r.status)
            .catch(() => -1),
        ),
      );
      statuses.push(...batch);
    }

    const blocked = statuses.filter((s) => s === 429).length;

    const result = {
      case: "A5",
      at: new Date().toISOString(),
      total,
      blocked,
      note: "General- und Socket-Limits waren fuer diesen Lauf auf 100000 angehoben; das PUBLIC-Limit blieb bei 600/min.",
    };
    const outDir = path.resolve(import.meta.dirname, "../../../../docs/testing/protokolle/messwerte");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, `${result.at.slice(0, 10)}-a5.json`), JSON.stringify(result, null, 2));

    // Konsistent mit dem Verdacht aus D3-1 (Zaehler pro Client verdoppelt;
    // Nachmessung nach dem Fix offen): sollte diese Vermutung zutreffen,
    // liegt die tatsaechliche Schwelle naeher bei 1200 als bei 600. Diese
    // Erwartung wird NICHT abgeschwaecht, falls `blocked` 0 ist -- ein
    // solcher Lauf gilt als rot und wird im Protokoll als mit dem D3-1-
    // Verdacht konsistent dokumentiert, nicht stillschweigend angepasst.
    expect(blocked).toBeGreaterThan(50);
    expect(blocked).toBeLessThan(150);

    const general = await api(session, "GET", "/organizations");
    expect(general.status).toBe(200);
  });
});
