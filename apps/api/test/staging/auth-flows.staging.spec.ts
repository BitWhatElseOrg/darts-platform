import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { playerSchema, publicTournamentDashboardSchema } from "@darts-platform/schemas";

import {
  api,
  createFixtureOrganization,
  errorMessage,
  readStagingConfig,
  signIn,
  type StagingSession,
} from "./staging-client.js";

const config = readStagingConfig();

/**
 * Sign-in ist auf 10 Anfragen/Minute je Client begrenzt (siehe
 * `staging-client.ts`). Diese Spezifikation meldet sich genau dreimal an:
 *
 * 1. hier in `beforeAll` — liefert die rohen `Set-Cookie`-Attribute fuer
 *    D4-1 UND dient als wiederverwendbare Sitzung fuer Block D5 (die
 *    Sitzung wird nirgends abgemeldet, bleibt also gueltig).
 * 2. in D4-2 — eigene Sitzung, die der Logout-Test abmeldet.
 * 3. in D4-3 — eigene Sitzung, die der Fremd-Origin-Test verbraucht (nach
 *    D4-2 ist die erste Sitzung bereits ungueltig, eine frische wird
 *    gebraucht, damit der 403 tatsaechlich am Origin-Check haengt und nicht
 *    schon an einer invalidierten Sitzung).
 */
let session: StagingSession;
let firstLoginSetCookie: string;

beforeAll(async () => {
  const response = await fetch(`${config.baseUrl}/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: config.origin },
    body: JSON.stringify({ email: config.email, password: config.password }),
  });
  if (response.status !== 200) {
    throw new Error(`Anmeldung fehlgeschlagen: ${response.status} ${await response.text()}`);
  }
  const setCookieHeaders = response.headers.getSetCookie();
  const cookieHeader = setCookieHeaders.find((c) => c.includes("session_token"));
  if (!cookieHeader) throw new Error("Kein Session-Cookie erhalten.");
  firstLoginSetCookie = cookieHeader;
  const cookie = setCookieHeaders.map((c) => c.split(";", 1)[0]).join("; ");
  session = { cookie, baseUrl: config.baseUrl, origin: config.origin };
});

describe("Block D4 – Auth-Flows", () => {
  it("D4-1: setzt das Session-Cookie mit HttpOnly, Secure, SameSite=Lax und dem __Secure-Praefix", () => {
    // Redigiert den Token-Wert, bevor er in eine Assertion-Fehlermeldung
    // geraten kann -- ein Fehlschlag darf das aktive Session-Cookie nicht im
    // Testoutput preisgeben. Der Cookie-NAME wird separat und ungekuerzt
    // geprueft, weil er kein Geheimnis ist.
    const cookieName = firstLoginSetCookie.split("=", 1)[0];
    const redacted = firstLoginSetCookie.replace(/^([^=]+)=[^;]*/u, "$1=<redacted>");
    expect(cookieName).toBe("__Secure-better-auth.session_token");
    expect(redacted).toMatch(/HttpOnly/iu);
    expect(redacted).toMatch(/Secure/iu);
    expect(redacted).toMatch(/SameSite=Lax/iu);
    expect(redacted).toMatch(/Max-Age=604800/u);
  });

  it("D4-2: invalidiert die Session beim Logout serverseitig", async () => {
    // Login #2 (siehe Budget-Kommentar oben).
    const logoutSession = await signIn(config.baseUrl, config.email, config.password, config.origin);
    const logout = await fetch(`${config.baseUrl}/auth/sign-out`, {
      method: "POST",
      headers: { cookie: logoutSession.cookie, origin: config.origin },
    });
    expect(logout.status).toBe(200);
    const afterwards = await fetch(`${config.baseUrl}/organizations`, {
      headers: { cookie: logoutSession.cookie, origin: config.origin },
    });
    expect(afterwards.status).toBe(401);
  });

  it("D4-3: weist eine fremde Origin bei einer Cookie-Anfrage an eine Auth-Route ab", async () => {
    // Login #3 (siehe Budget-Kommentar oben) — eine frische Sitzung, weil
    // die von D4-2 durch den Logout dort bereits ungueltig ist.
    const foreignSession = await signIn(config.baseUrl, config.email, config.password, config.origin);
    const foreign = await fetch(`${config.baseUrl}/auth/sign-out`, {
      method: "POST",
      headers: { cookie: foreignSession.cookie, origin: "https://angreifer.example" },
    });
    expect(foreign.status).toBe(403);
  });

  it("D4-4: weist eine Cookie-Anfrage an eine Auth-Route ganz ohne Origin-Header ab", async () => {
    // Kein zusaetzliches Sign-in: Better Auths Origin-Pruefung greift laut
    // `origin-check.mjs` (`validateOrigin`) nur, wenn die Anfrage einen
    // `cookie`-Header traegt (`useCookies`); ohne Cookie ueberspringt sie die
    // Pruefung komplett (eine anonyme Anfrage ohne Origin scheitert NICHT
    // hieran). Diese Sitzung (Login #1) eignet sich trotzdem, weil eine bei
    // der Origin-Pruefung abgelehnte Anfrage nie bis zur eigentlichen
    // Sign-out-Logik vordringt und die Sitzung folglich nicht invalidiert —
    // Block D5 kann sie unten unveraendert weiterverwenden.
    const response = await fetch(`${config.baseUrl}/auth/sign-out`, {
      method: "POST",
      headers: { cookie: session.cookie },
    });
    expect(response.status).toBe(403);
  });
});

/**
 * D5 pruefte am 18.09.2026 in einem vollen `pnpm test:staging`-Lauf mit
 * `test-runner-2@example.test` fehlerhaft: Block A5 (Lasttest gegen die
 * oeffentliche Stufe, `RATE_LIMIT_PUBLIC_MAX_PER_MINUTE`) schoepft das
 * 60-Sekunden-Fenster genau dann aus, wenn D5 direkt danach laeuft — D5-1/2/3
 * scheitern dann an 429 statt am eigentlich zu pruefenden Verhalten (D5
 * allein war gruen). Diese Probe fragt vor D5 einmal die oeffentliche Stufe
 * ab (mit einer garantiert unbekannten `publicId`, damit kein echtes
 * Turnier gebraucht wird) und wartet noetigenfalls auf ein freies Fenster,
 * bevor die D5-Faelle selbst Anfragen stellen.
 */
async function waitForFreePublicWindow(): Promise<void> {
  const PLACEHOLDER_PUBLIC_ID = "00000000-0000-4000-8000-000000000000";
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetch(`${config.baseUrl}/public/tournaments/${PLACEHOLDER_PUBLIC_ID}/live`);
    const remaining = Number(response.headers.get("x-ratelimit-remaining") ?? "0");
    if (response.status !== 429 && remaining >= 20) return;
    const resetSeconds = Number(response.headers.get("x-ratelimit-reset") ?? "60");
    const waitMs = Math.min(70_000, (resetSeconds + 2) * 1000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

describe("Block D5 – Öffentliche Routen geben keine internen Daten preis", () => {
  let publicId: string;
  let privatePublicId: string;

  beforeAll(async () => {
    await waitForFreePublicWindow();
    const runId = `d5-${Date.now()}`;
    const { organizationId, playerIds, boardId } = await createFixtureOrganization(session, runId);
    const extraPlayers = await Promise.all(
      [3, 4].map((n) =>
        api(
          session,
          "POST",
          `/organizations/${organizationId}/players`,
          { displayName: `D5 Spieler ${n} ${runId}`, status: "ACTIVE" },
          playerSchema,
        ),
      ),
    );
    for (const player of extraPlayers) {
      if (player.status !== 201) {
        throw new Error(`Spieler nicht angelegt: ${errorMessage(player.status, player.data)}`);
      }
    }
    const participantIds = [...playerIds, ...extraPlayers.map((p) => p.data.id)];

    const createTournament = (name: string) =>
      api<{ id: string }>(session, "POST", `/organizations/${organizationId}/tournaments`, {
        name,
        startsAt: new Date().toISOString(),
        format: "SINGLE_ELIMINATION",
        startingScore: 501,
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
        bestOfLegs: 1,
        bestOfSets: 1,
        participantIds,
        groupCount: 1,
        qualifyPerGroup: 1,
        knockoutSize: 4,
        seeding: "SEEDED",
        boardIds: [boardId],
      });

    // Oeffentliches Turnier: PATCH visibility -> PUBLIC, publicId aus dem Dashboard.
    const publicTournament = await createTournament(`D5 Öffentlich ${runId}`);
    if (publicTournament.status !== 201) {
      throw new Error(`Turnier nicht angelegt: ${errorMessage(publicTournament.status, publicTournament.data)}`);
    }
    const visibility = await api(
      session,
      "PATCH",
      `/organizations/${organizationId}/tournaments/${publicTournament.data.id}/visibility`,
      { visibility: "PUBLIC" },
    );
    if (visibility.status !== 200) {
      throw new Error(`Sichtbarkeit nicht gesetzt: ${errorMessage(visibility.status, visibility.data)}`);
    }
    const publicDashboard = await api<{ tournament: { publicId: string } }>(
      session,
      "GET",
      `/organizations/${organizationId}/tournaments/${publicTournament.data.id}/dashboard`,
    );
    publicId = publicDashboard.data.tournament.publicId;

    // Privates Turnier: bleibt auf dem DB-Default PRIVATE (kein PATCH visibility).
    const privateTournament = await createTournament(`D5 Privat ${runId}`);
    if (privateTournament.status !== 201) {
      throw new Error(`Turnier nicht angelegt: ${errorMessage(privateTournament.status, privateTournament.data)}`);
    }
    const privateDashboard = await api<{ tournament: { publicId: string } }>(
      session,
      "GET",
      `/organizations/${organizationId}/tournaments/${privateTournament.data.id}/dashboard`,
    );
    privatePublicId = privateDashboard.data.tournament.publicId;
  });

  it("D5-1: das öffentliche Dashboard entspricht der öffentlichen Form und verrät keine internen Felder", async () => {
    const response = await fetch(`${config.baseUrl}/public/tournaments/${publicId}/live`);
    expect(response.status).toBe(200);
    const rawText = await response.text();
    const body: unknown = JSON.parse(rawText);

    // Formkontrolle: wirft, wenn ein Pflichtfeld der oeffentlichen Form
    // fehlt oder falsch typisiert ist. Ein z.object() ohne `.strict()`
    // wuerde ein ZUSAETZLICHES Feld beim Parsen stillschweigend
    // durchlassen — deshalb prueft die Verbotsliste unten den ROHEN Text,
    // nicht das (durch das Schema bereits bereinigte) geparste Objekt.
    publicTournamentDashboardSchema.parse(body);

    // Absichtlich NICHT in dieser Liste: "version" — `tournament.version`
    // und das `version` eines laufenden Matches in `boards[].match` sind
    // Teil der oeffentlichen Form (`publicTournamentDashboardSchema`,
    // packages/schemas/src/tournament.ts) und keine Preisgabe.
    const forbidden = [
      "@example.test",
      '"organizationId"',
      '"userId"',
      '"email"',
      '"id":',
      '"visibility"',
      '"blockedReason"',
      '"withdrawnAt"',
      '"withdrawalReason"',
    ];
    for (const needle of forbidden) {
      expect(rawText).not.toContain(needle);
    }
  });

  it("D5-2: eine unbekannte publicId liefert 404 im einheitlichen Fehlerformat", async () => {
    const response = await fetch(`${config.baseUrl}/public/tournaments/${randomUUID()}/live`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; correlationId: string } };
    expect(typeof body.error.code).toBe("string");
    expect(typeof body.error.correlationId).toBe("string");
  });

  it("D5-3: ein privates Turnier bleibt ohne Anzeige-Schlüssel verborgen (nicht 2xx)", async () => {
    const response = await fetch(`${config.baseUrl}/public/tournaments/${privatePublicId}/live`);
    // `tournaments.service.ts` (`publicDashboard`) antwortet fuer ein
    // privates Turnier ohne gueltigen Anzeige-Schluessel bewusst mit
    // demselben 404 wie fuer eine unbekannte publicId — ein 403 wuerde
    // verraten, dass die Adresse existiert. Die Mindestanforderung (nicht
    // 2xx) steht als generelle Schranke; hier zusaetzlich der konkret
    // erwartete Code.
    const isSuccess = response.status >= 200 && response.status < 300;
    expect(isSuccess).toBe(false);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; correlationId: string } };
    expect(typeof body.error.code).toBe("string");
    expect(typeof body.error.correlationId).toBe("string");
  });
});
