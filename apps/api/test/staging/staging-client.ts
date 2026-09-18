import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  boardSchema,
  matchStateSchema,
  organizationSummarySchema,
  playerSchema,
} from "@darts-platform/schemas";

/**
 * `MatchState` wird von `@darts-platform/schemas` nicht als Typ exportiert
 * (nur `MatchStateResponse`). Statt das Schema-Paket dafuer zu erweitern,
 * leiten wir den Typ hier lokal ab; Aufrufer, die selbst gegen
 * `matchStateSchema` validieren (Task 9/10), brauchen ihn ohnehin nicht.
 */
export type MatchState = z.infer<typeof matchStateSchema>;

export interface StagingSession {
  readonly cookie: string;
  readonly baseUrl: string;
  readonly origin: string;
}

export function readStagingConfig(): {
  baseUrl: string;
  email: string;
  password: string;
  origin: string;
} {
  const baseUrl = process.env.STAGING_API_URL;
  const email = process.env.STAGING_EMAIL;
  const password = process.env.STAGING_PASSWORD;
  const origin = process.env.STAGING_WEB_ORIGIN ?? "https://staging.dartbase.ch";
  if (!baseUrl || !email || !password) {
    throw new Error(
      "STAGING_API_URL, STAGING_EMAIL und STAGING_PASSWORD muessen gesetzt sein (siehe .env.staging).",
    );
  }
  return { baseUrl: baseUrl.replace(/\/$/u, ""), email, password, origin };
}

/**
 * Better Auth prueft bei `/auth/*` den Origin-Header, sobald der Client
 * `sec-fetch-mode` mitschickt (Node-`fetch`/undici tut das immer). Ohne
 * passenden, in `trustedOrigins` gelisteten Origin antwortet Staging mit
 * 403 `MISSING_OR_NULL_ORIGIN`.
 *
 * Vertrag: genau einmal pro Testdatei anmelden (Modul-Scope oder
 * `beforeAll`), niemals pro Testfall. Staging begrenzt sensible Routen wie
 * `/auth/sign-in/email` auf 10 Anfragen pro Minute und Client-Schluessel;
 * ein Sign-in je `it(...)` sprengt dieses Limit bereits bei wenigen Tests.
 */
export async function signIn(
  baseUrl: string,
  email: string,
  password: string,
  origin: string = process.env.STAGING_WEB_ORIGIN ?? "https://staging.dartbase.ch",
): Promise<StagingSession> {
  const response = await fetch(`${baseUrl}/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`Anmeldung fehlgeschlagen: ${response.status} ${await response.text()}`);
  }
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";", 1)[0])
    .join("; ");
  if (!/better-auth\.session_token=/u.test(cookie)) {
    throw new Error("Kein Session-Cookie erhalten.");
  }
  return { cookie, baseUrl, origin };
}

/**
 * Formatiert eine Fehlerantwort fuer `throw new Error(...)`-Stellen: Code und
 * Nachricht bei einem Plattformfehler (`{error:{code,message,...}}`), sonst
 * ein auf 200 Zeichen gekuerzter Textausschnitt (z. B. eine Proxy-HTML-Seite
 * bei 502/504). Enthaelt nie Cookies oder andere Kopfzeilen.
 */
export function errorMessage(status: number, data: unknown): string {
  if (data !== null && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (error !== null && typeof error === "object" && "code" in error) {
      const code = String((error as { code: unknown }).code);
      const message =
        "message" in error && (error as { message?: unknown }).message !== undefined
          ? String((error as { message: unknown }).message)
          : null;
      return `HTTP ${status} ${code}${message ? `: ${message}` : ""}`;
    }
  }
  const text = typeof data === "string" ? data : JSON.stringify(data);
  const excerpt = text.length > 200 ? `${text.slice(0, 200)}…` : text;
  return `HTTP ${status}: ${excerpt}`;
}

export async function api<T = unknown>(
  session: StagingSession,
  method: string,
  path: string,
  body?: unknown,
  schema?: z.ZodType<T>,
): Promise<{ status: number; data: T }> {
  const response = await fetch(`${session.baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: session.cookie,
      accept: "application/json",
      origin: session.origin,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  // Tolerant parsen: ein Proxy-Fehler (502/504) kann HTML oder Klartext statt
  // JSON liefern. Ein SyntaxError an dieser Stelle wuerde Status und Koerper
  // verschlucken, bevor die Aufrufer sie pruefen koennen.
  let parsed: unknown;
  if (text.length === 0) {
    parsed = null;
  } else {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    // Fehlerantworten laufen NIE durch das Erfolgsschema: ein
    // Plattformfehler `{error:{code,message,correlationId}}` wuerde sonst
    // z. B. gegen `organizationSummarySchema` scheitern und eine verwirrende
    // ZodError statt `error.code` liefern. Aufrufer pruefen `status` und
    // lesen `data`/`error.code` selbst (siehe Task 9, Fall A1).
    return { status: response.status, data: parsed as T };
  }
  return { status: response.status, data: (schema ? schema.parse(parsed) : parsed) as T };
}

export async function createFixtureOrganization(
  session: StagingSession,
  runId: string,
): Promise<{ organizationId: string; playerIds: [string, string]; boardId: string }> {
  const org = await api(
    session,
    "POST",
    "/organizations",
    { name: `Lasttest ${runId}`, slug: `lasttest-${runId}`.toLowerCase() },
    organizationSummarySchema,
  );
  if (org.status !== 201) throw new Error(`Organisation nicht angelegt: ${errorMessage(org.status, org.data)}`);
  const organizationId = org.data.id;

  const players = await Promise.all(
    [1, 2].map((n) =>
      api(
        session,
        "POST",
        `/organizations/${organizationId}/players`,
        { displayName: `Spieler ${n} ${runId}`, status: "ACTIVE" },
        playerSchema,
      ),
    ),
  );
  for (const player of players) {
    if (player.status !== 201) {
      throw new Error(`Spieler nicht angelegt: ${errorMessage(player.status, player.data)}`);
    }
  }

  const board = await api(
    session,
    "POST",
    `/organizations/${organizationId}/boards`,
    { name: `Board ${runId}` },
    boardSchema,
  );
  if (board.status !== 201) throw new Error(`Board nicht angelegt: ${errorMessage(board.status, board.data)}`);

  return {
    organizationId,
    playerIds: [players[0]!.data.id, players[1]!.data.id],
    boardId: board.data.id,
  };
}

export async function createMatch(
  session: StagingSession,
  organizationId: string,
  playerIds: [string, string],
  boardId: string | null,
): Promise<MatchState> {
  const created = await api(
    session,
    "POST",
    `/organizations/${organizationId}/matches`,
    { playerOneId: playerIds[0], playerTwoId: playerIds[1], boardId, bestOfLegs: 1, bestOfSets: 1 },
    matchStateSchema,
  );
  if (created.status !== 201) {
    throw new Error(`Match nicht angelegt: ${errorMessage(created.status, created.data)}`);
  }
  return created.data;
}

export function visit(playerId: string, expectedVersion: number, points: number) {
  return {
    commandId: randomUUID(),
    expectedVersion,
    playerId,
    points,
    dartsThrown: 3 as const,
  };
}
