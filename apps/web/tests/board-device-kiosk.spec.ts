import type { BrowserContext, Locator, Page, Request } from "@playwright/test";

import { expect, test } from "./fixtures";
import { randomUUID } from "node:crypto";

import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";
import {
  decideLegStart,
  recordDartVisit,
  selectCheckoutDarts,
  switchInputMode,
  typeRoundScore,
} from "./scoreboard-entry";
import { signUpWithOrganization } from "./sign-up";

/**
 * E2E für Scheiben-Tablets (Spec 2026-09-30-scheiben-tablet, Task 12):
 * einrichten in der installierten App, ein zugewiesenes Match übernehmen und
 * scoren, entkoppeln.
 *
 * `isStandaloneDisplay()` (`standalone-display.ts`) liest
 * `window.matchMedia("(display-mode: standalone)")` — ein gewöhnlicher
 * Playwright-Kontext meldet dort nie "standalone". Jeder Tablet-Kontext
 * überschreibt `matchMedia` deshalb per `addInitScript`, bevor die erste Seite
 * lädt, und meldet es (da der Kontext nur eine Seite öffnet) für den ganzen
 * weiteren Lauf dieses Kontexts.
 *
 * Admin und Tablet sind zwei getrennte Browser-Kontexte: der Wechsel zwischen
 * beiden ist genau der Punkt des Falls, ein serverseitiges Poll
 * (`/board-devices/me`, alle 5 s) verbindet sie statt einer gemeinsamen
 * Sitzung.
 */

const ADMIN_PASSWORD = "E2ePassword123!";

const registrationSeeds: RegistrationInvitationSeed[] = [];

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

/**
 * Simuliert die installierte App (Spec Abschnitt 2): iOS-`navigator.standalone`
 * gibt es in Chromium nicht, `matchMedia("(display-mode: standalone)")` schon
 * — sie meldet in einem gewöhnlichen Browser-Tab aber `matches: false`. Muss
 * vor der ersten Navigation registriert sein, sonst sieht `isStandaloneDisplay()`
 * beim ersten Mount noch das echte `matchMedia`.
 */
async function overrideStandaloneDisplay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes("standalone"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      onchange: null,
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  });
}

/**
 * Meldet denselben Admin-Account in einem zweiten (Tablet-)Kontext an. Das
 * Konto existiert bereits (`signUpWithOrganization` im Admin-Kontext hat es
 * angelegt) — hier greift deshalb der Anmelden-Zweig von `auth-panel.tsx`,
 * nicht die Registrierung.
 */
async function signInAsAdmin(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByRole("link", { name: "Turnierleitung" })).toBeVisible();
}

async function addPlayer(page: Page, displayName: string): Promise<void> {
  await page.getByLabel("Anzeigename", { exact: true }).fill(displayName);
  await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
  await expect(page.getByText(displayName, { exact: true }).first()).toBeVisible();
}

async function addBoard(page: Page, name: string): Promise<void> {
  await page.getByLabel("Neues Board").fill(name);
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await expect(
    page.locator("li").filter({ hasText: name }).filter({ hasText: "frei" }),
  ).toBeVisible();
}

/**
 * Richtet das Tablet über die Organisationsverwaltung ein
 * (`board-devices-section.tsx`) und wartet auf den Kiosk-Leerlauf
 * (`kiosk-route.tsx`). Setzt voraus, dass `page` bereits als Admin
 * angemeldet und `overrideStandaloneDisplay` bereits registriert ist — sonst
 * bleibt „Dieses Gerät einrichten" gesperrt.
 */
async function pairBoardDevice(page: Page, organizationId: string, boardName: string): Promise<void> {
  await page.goto(`/organisation?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Organisation" })).toBeVisible();
  const boardRow = page.locator("li").filter({ hasText: boardName });
  await expect(boardRow.getByText("Kein Gerät")).toBeVisible();
  await boardRow.getByRole("button", { name: "Dieses Gerät einrichten" }).click();
  await expect(page).toHaveURL(/\/scheibe$/u);
  await expect(page.getByText(`${boardName} – wartet auf nächstes Match`)).toBeVisible();
}

/**
 * Task-Review-Befund: der Tablet-Kontext meldet sich zwar vor dem Einrichten
 * als Admin an (`signInAsAdmin`), `board-devices-section.tsx` ruft danach
 * aber `authClient.signOut()` auf, BEVOR es in den Kiosk wechselt — das
 * Admin-Session-Cookie soll an diesem Punkt bereits weg sein. Ohne diese
 * Prüfung bewiese das anschliessende Scoren nicht zuverlässig den
 * Geräteschlüssel: fiele ein Lesepfad (Anwurf, Checkout, Undo,
 * Quick-Scores) auf eine noch gültige Cookie-Sitzung zurück, bliebe der Fall
 * trotzdem grün, obwohl die eigentliche Geräteschlüssel-Autorisierung nie
 * geprüft wurde.
 *
 * Zusätzlich zur Prüfung werden alle Cookies des Kontexts entfernt und die
 * Kiosk-Seite neu geladen (`clearCookies` wirkt nicht rückwirkend auf schon
 * offene Verbindungen) — der Rest des jeweiligen Falls scort damit
 * nachweislich nur noch über den Geräteschlüssel aus `localStorage`, der von
 * `clearCookies` unberührt bleibt.
 */
async function confirmDeviceOnlySession(
  context: BrowserContext,
  page: Page,
  boardName: string,
): Promise<void> {
  const cookiesAfterSignOut = await context.cookies();
  expect(
    cookiesAfterSignOut.some((cookie) => cookie.name.startsWith("better-auth.session_token")),
    "Admin-Session-Cookie ist nach dem Einrichten (authClient.signOut()) noch im Tablet-Kontext vorhanden",
  ).toBe(false);

  await context.clearCookies();
  await page.reload();
  await expect(page.getByText(`${boardName} – wartet auf nächstes Match`)).toBeVisible();
}

/** Entkoppelt das Tablet über „Entkoppeln" + Bestätigungsdialog. */
async function revokeBoardDevice(page: Page, organizationId: string, boardName: string): Promise<void> {
  await page.goto(`/organisation?organisation=${organizationId}`);
  const boardRow = page.locator("li").filter({ hasText: boardName });
  const revokeButton = boardRow.getByRole("button", { name: "Entkoppeln" });
  await expect(revokeButton).toBeEnabled();
  await revokeButton.click();
  const dialog = page.getByRole("dialog", { name: "Tablet entkoppeln" });
  await expect(dialog).toBeVisible();
  const confirmButton = dialog.getByRole("button", { name: "Entkoppeln" });
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(dialog).toHaveCount(0);
}

test(
  "a club pairs a board tablet, plays a tournament match on it, and unpairs it",
  async ({ browser, page }) => {
    test.slow();
    // Zwei Kontexte (Admin, Tablet), ein kompletter Turniermatch samt zweier
    // 10s-Polling-Wartungen (Match kommt an, Widerruf kommt an) und ein kalter
    // `next dev` (jede Route übersetzt beim ersten Aufruf, siehe
    // `playwright.config.ts`) brauchen mehr als das Standardbudget.
    test.setTimeout(300_000);

    const suffix = randomUUID();
    const short = suffix.slice(0, 8);
    const email = `e2e-scheibe-turnier-${suffix}@example.test`;
    const boardName = "Scheibe 1";
    const tournamentName = `E2E Scheibencup ${short}`;
    // Ein Turnier braucht mindestens vier Teilnehmer (Setup-Validierung);
    // welches Spielerpaar die Engine dem einzigen Board zuerst zuweist, ist
    // hier ohne Belang — gescort wird ohne Bezug auf einen Namen.
    const players = [
      `E2E Scheibe Eins ${short}`,
      `E2E Scheibe Zwei ${short}`,
      `E2E Scheibe Drei ${short}`,
      `E2E Scheibe Vier ${short}`,
    ];

    const invitation = await createRegistrationInvitation(email);
    registrationSeeds.push(invitation);

    const { organizationId } = await signUpWithOrganization(page, {
      claimToken: invitation.claimToken,
      email,
      organizationName: `E2E Scheibe Club ${short}`,
      organizationSlug: `e2e-scheibe-club-${suffix}`,
      ownerName: "E2E Scheibe Leitung",
    });

    await page.goto(`/spieler?organisation=${organizationId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Spieler & Team" })).toBeVisible();
    for (const name of players) await addPlayer(page, name);

    await page.goto(`/matches?organisation=${organizationId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
    await addBoard(page, boardName);

    const tabletContext = await browser.newContext();
    try {
      const tabletPage = await tabletContext.newPage();
      await overrideStandaloneDisplay(tabletPage);
      await signInAsAdmin(tabletPage, email);
      await pairBoardDevice(tabletPage, organizationId, boardName);
      await confirmDeviceOnlySession(tabletContext, tabletPage, boardName);

      // Admin: Turnier mit der zuvor angelegten Scheibe anlegen und das erste
      // (und einzige) Match bei zwei Teilnehmenden zuweisen.
      await page.goto(`/turniere/neu?organisation=${organizationId}`);
      await page.getByLabel("Format").selectOption("ROUND_ROBIN");
      await page.getByLabel("Name").fill(tournamentName);
      await page.getByLabel("Best of Legs").selectOption("1");
      await Promise.all([
        page.waitForURL(/\/turniere\/[^/?]+\?organisation=/u),
        page.getByRole("button", { name: "Turnier starten" }).click(),
      ]);
      await expect(page.getByRole("heading", { level: 1, name: tournamentName })).toBeVisible();
      await page.getByRole("button", { name: `Auf ${boardName} starten` }).click();
      await expect(page.getByRole("heading", { level: 3, name: boardName })).toBeVisible();

      // Tablet: das zugewiesene Match kommt über das Poll von
      // `/board-devices/me` (alle 5 s) an.
      await expect(tabletPage.getByRole("region", { name: "Match-Scoreboard" })).toBeVisible({
        timeout: 10_000,
      });
      await decideLegStart(tabletPage);
      await switchInputMode(tabletPage, "Runde");

      const record = async (
        score: number,
        checkout?: { readonly field: number; readonly darts: 1 | 2 | 3 },
      ) => {
        await typeRoundScore(tabletPage, score);
        if (checkout === undefined) {
          await expect(
            tabletPage.getByRole("button", { name: /^(Fehlwurf|Ziffer 0)$/u }).first(),
          ).toBeEnabled();
          return;
        }
        const dialog = tabletPage.getByRole("dialog", { name: "Checkout erfassen" });
        await expect(dialog).toBeVisible();
        await dialog.getByLabel("Checkout-Feld").selectOption(String(checkout.field));
        await selectCheckoutDarts(dialog, checkout.darts);
        await dialog.getByRole("button", { name: "Checkout speichern" }).click();
      };
      // 501, ein Leg: 180 / 0 / 180 / 0 / 141 (Checkout T20 T19 D12).
      await record(180);
      await record(0);
      await record(180);
      await record(0);
      await record(141, { field: 12, darts: 3 });

      await expect(tabletPage.getByText("Match beendet")).toBeVisible({ timeout: 15_000 });
      // Der „Weiter"-Knopf erscheint erst, sobald der Kiosk selbst den
      // COMPLETED-Uebergang ueber seine eigene Match-Abfrage gesehen hat
      // (`kiosk-route.tsx`, `seenMatch`-Effekt) — das kann einen Poll-Zyklus
      // nach dem Checkout liegen. Eine gebundene, aber grosszuegige Wartung
      // hier statt eines ungebremsten `.click()`, das sonst bis zum vollen
      // Testzeitbudget haengen bliebe, wenn der Knopf nie erscheint.
      const weiterButton = tabletPage.getByRole("button", { name: "Weiter" });
      await expect(weiterButton).toBeVisible({ timeout: 15_000 });
      await weiterButton.click();
      await expect(tabletPage.getByText(`${boardName} – wartet auf nächstes Match`)).toBeVisible({
        timeout: 10_000,
      });

      // Admin: entkoppeln.
      await revokeBoardDevice(page, organizationId, boardName);

      // Tablet: der Widerruf kommt über dasselbe Poll an.
      await expect(
        tabletPage.getByText(
          "Dieses Tablet ist nicht mehr gekoppelt – bitte in der Organisationsverwaltung unter «Scheiben-Tablets» neu einrichten.",
        ),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await tabletContext.close();
    }
  },
);

const HOME_PLAYERS_PREFIX = "Heim Scheibe";
const AWAY_PLAYERS_PREFIX = "Gast Scheibe";
const SLOT_SINGLES_ONE = "Einzel 1 · Heim 1 gegen Gast 1";

/**
 * Der Spielabend liegt bewusst in der nahen Zukunft und ist nicht fest
 * verdrahtet — siehe `team-encounter.spec.ts`, derselbe Grund
 * (`loadSquad`/Spielberechtigung am Spieltag, Memory „Kader zum Spieltag").
 */
function upcomingFixtureSlot(): string {
  const slot = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  slot.setHours(20, 0, 0, 0);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${slot.getFullYear()}-${pad(slot.getMonth() + 1)}-${pad(slot.getDate())}T${pad(slot.getHours())}:${pad(slot.getMinutes())}`;
}

function slotRow(page: Page, label: string): Locator {
  return page
    .getByRole("region", { name: "Spiele der Begegnung" })
    .getByRole("listitem")
    .filter({ hasText: label });
}

async function createTeam(
  page: Page,
  input: { readonly name: string; readonly shortName: string; readonly members: readonly string[] },
): Promise<void> {
  await page.getByLabel("Name", { exact: true }).fill(input.name);
  await page.getByLabel("Kurzname", { exact: true }).fill(input.shortName);
  await page.getByRole("button", { name: "Team anlegen" }).click();

  const card = page.getByRole("article", { name: input.name });
  await expect(card).toBeVisible();
  for (const member of input.members) {
    await card.getByLabel("Person aufnehmen").selectOption({ label: member });
    await card.getByRole("button", { name: "Aufnehmen" }).click();
    await expect(card.getByText(member, { exact: true })).toBeVisible();
  }
  await expect(card).toContainText(`${input.members.length} Personen im Kader`);
}

async function nominate(
  page: Page,
  side: "Heim" | "Gast",
  players: readonly [string, string, string],
): Promise<void> {
  const panel = page.getByRole("region", { name: new RegExp(`^Meldung ${side}`, "u") });
  await panel.getByLabel("Position 1").selectOption({ label: players[0] });
  await panel.getByLabel("Position 2").selectOption({ label: players[1] });
  await panel.getByLabel("Ersatz 1").selectOption({ label: players[2] });
  await panel.getByRole("button", { name: "Meldung erfassen" }).click();
  await expect(panel.getByText("gemeldet", { exact: true })).toBeVisible();
}

async function assignSlot(page: Page, label: string, boardName: string): Promise<void> {
  const row = slotRow(page, label);
  await row.getByLabel("Board", { exact: true }).selectOption({ label: boardName });
  await row.getByRole("button", { name: "Auf Board starten" }).click();
  await expect(row).toContainText("läuft");
}

test(
  "a club assigns a league slot to a paired board tablet",
  async ({ browser, page }) => {
    test.slow();
    test.setTimeout(180_000);

    const suffix = randomUUID();
    const short = suffix.slice(0, 8);
    const email = `e2e-scheibe-liga-${suffix}@example.test`;
    const boardName = "Scheibe 1";
    const homeTeam = `E2E Scheibe Heim ${short}`;
    const awayTeam = `E2E Scheibe Gast ${short}`;
    const competitionName = `E2E Scheibe Liga ${short}`;
    const homePlayers = [
      `${HOME_PLAYERS_PREFIX} Eins ${short}`,
      `${HOME_PLAYERS_PREFIX} Zwei ${short}`,
      `${HOME_PLAYERS_PREFIX} Drei ${short}`,
    ] as const;
    const awayPlayers = [
      `${AWAY_PLAYERS_PREFIX} Eins ${short}`,
      `${AWAY_PLAYERS_PREFIX} Zwei ${short}`,
      `${AWAY_PLAYERS_PREFIX} Drei ${short}`,
    ] as const;

    const invitation = await createRegistrationInvitation(email);
    registrationSeeds.push(invitation);

    const { organizationId } = await signUpWithOrganization(page, {
      claimToken: invitation.claimToken,
      email,
      organizationName: `E2E Scheibe Liga Club ${short}`,
      organizationSlug: `e2e-scheibe-liga-club-${suffix}`,
      ownerName: "E2E Scheibe Ligaleitung",
    });

    await page.goto(`/spieler?organisation=${organizationId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Spieler & Team" })).toBeVisible();
    for (const name of [...homePlayers, ...awayPlayers]) await addPlayer(page, name);

    await page.goto(`/teams?organisation=${organizationId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible();
    await createTeam(page, { name: homeTeam, shortName: "ESH", members: homePlayers });
    await createTeam(page, { name: awayTeam, shortName: "ESG", members: awayPlayers });

    await page.goto(`/matches?organisation=${organizationId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
    await addBoard(page, boardName);

    const tabletContext = await browser.newContext();
    try {
      const tabletPage = await tabletContext.newPage();
      await overrideStandaloneDisplay(tabletPage);
      await signInAsAdmin(tabletPage, email);
      await pairBoardDevice(tabletPage, organizationId, boardName);
      await confirmDeviceOnlySession(tabletContext, tabletPage, boardName);

      // Admin: Wettbewerb und Begegnung wie in `team-encounter.spec.ts`, aber
      // die Zuweisung erfolgt über die Begegnung, nicht über ein Turnier.
      await page.goto(`/liga?organisation=${organizationId}`);
      await page.getByRole("link", { name: "Wettbewerb anlegen", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Wettbewerb anlegen" })).toBeVisible();
      await page.getByLabel("Name", { exact: true }).fill(competitionName);
      await page.getByLabel("Aufstellungspositionen").selectOption("2");
      await page.getByLabel("Reguläre Doppel", { exact: true }).selectOption("1");
      await page.getByLabel("Distanz je Spiel").selectOption("1");
      await page.getByLabel("Mindestmeldung").fill("3");
      await page.getByLabel("Ausnahmemeldung").fill("2");
      await Promise.all([
        page.waitForURL(/\/liga\/[0-9a-f-]{36}\?organisation=/u),
        page.getByRole("button", { name: "Wettbewerb anlegen" }).click(),
      ]);
      await expect(page.getByRole("heading", { level: 1, name: competitionName })).toBeVisible();

      await page.getByLabel("Spieltag").fill("1");
      await page.getByLabel("Heim", { exact: true }).selectOption({ label: homeTeam });
      await page.getByLabel("Gast", { exact: true }).selectOption({ label: awayTeam });
      await page.getByLabel("Spielabend").fill(upcomingFixtureSlot());
      await page.getByLabel("Ort").fill("Clublokal");
      await Promise.all([
        page.waitForURL(/\/liga\/begegnungen\/[0-9a-f-]{36}\?organisation=/u),
        page.getByRole("button", { name: "Ansetzen" }).click(),
      ]);
      await expect(
        page.getByRole("heading", { level: 1, name: `${homeTeam} gegen ${awayTeam}` }),
      ).toBeVisible();

      await nominate(page, "Heim", homePlayers);
      await nominate(page, "Gast", awayPlayers);
      await page.getByRole("button", { name: "Begegnung starten" }).click();
      await assignSlot(page, SLOT_SINGLES_ONE, boardName);

      // Tablet: das zugewiesene Begegnungsspiel kommt über dasselbe Poll an.
      await expect(tabletPage.getByRole("region", { name: "Match-Scoreboard" })).toBeVisible({
        timeout: 10_000,
      });

      // Team-Begegnungen kennen kein Ausbullen (anders als freie/
      // Turniermatches, siehe `team-encounter.spec.ts`): die Heimseite eröffnet
      // direkt. Unter Double In (Vorgabe jedes voreingestellten
      // Ligawettbewerbs, `competition-setup.tsx`) läuft die Eröffnungsaufnahme
      // Wurf für Wurf — D20+T20 eröffnet auf dem Doppel, der dritte Wurf
      // schliesst die Aufnahme ab, ohne zu zählen.
      const homeScore = tabletPage.getByLabel(`${homePlayers[0]}, Restscore`);
      await expect(homeScore).toHaveText("501");
      await recordDartVisit(tabletPage, ["D20", "T20", "MISS"]);
      await expect(homeScore).toHaveText("401");
    } finally {
      await tabletContext.close();
    }
  },
);

/**
 * Bis hierher war die Anfragenzahl eines Kiosk-Tablets nur gerechnet
 * (Spec §3, ADR 0019, Kommentar bei
 * `RATE_LIMIT_DEVICE_MAX_PER_MINUTE`), nicht live gemessen. Dieser Fall
 * zaehlt tatsaechliche Anfragen -- ein 30s-Fenster waehrend ein Match laeuft
 * (ohne Eingaben), ein 60s-Fenster im Leerlauf -- und rechnet sie auf eine
 * Minute hoch. Prueft dabei auch Ober- UND Untergrenze: eine zu niedrige
 * Zahl waere genauso ein Befund (URL-Filter greift nicht mehr, Polling
 * faellt aus) wie eine zu hohe.
 */
test(
  "measures the request rate of a paired board tablet during a match and while idle",
  async ({ browser, page }) => {
    test.slow();
    // Ein 30s-Messfenster im Match, ein 60s-Fenster im Leerlauf (siehe
    // Kommentar bei dessen Grenze unten) plus Turnieraufbau, Zuweisung und
    // ein komplettes Leg (siehe Kommentar beim ersten Fall dieser Datei zum
    // kalten `next dev`) brauchen deutlich mehr als das Standardbudget.
    test.setTimeout(330_000);

    const suffix = randomUUID();
    const short = suffix.slice(0, 8);
    const email = `e2e-scheibe-messung-${suffix}@example.test`;
    const boardName = "Scheibe 1";
    const tournamentName = `E2E Messcup ${short}`;
    const players = [
      `E2E Messung Eins ${short}`,
      `E2E Messung Zwei ${short}`,
      `E2E Messung Drei ${short}`,
      `E2E Messung Vier ${short}`,
    ];

    const invitation = await createRegistrationInvitation(email);
    registrationSeeds.push(invitation);

    const { organizationId } = await signUpWithOrganization(page, {
      claimToken: invitation.claimToken,
      email,
      organizationName: `E2E Messung Club ${short}`,
      organizationSlug: `e2e-messung-club-${suffix}`,
      ownerName: "E2E Messung Leitung",
    });

    await page.goto(`/spieler?organisation=${organizationId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Spieler & Team" })).toBeVisible();
    for (const name of players) await addPlayer(page, name);

    await page.goto(`/matches?organisation=${organizationId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
    await addBoard(page, boardName);

    const tabletContext = await browser.newContext();
    try {
      const tabletPage = await tabletContext.newPage();
      await overrideStandaloneDisplay(tabletPage);
      await signInAsAdmin(tabletPage, email);
      await pairBoardDevice(tabletPage, organizationId, boardName);
      await confirmDeviceOnlySession(tabletContext, tabletPage, boardName);

      // API-Basis dieser Testumgebung: `playwright.config.ts` setzt den
      // Web-Server auf `NEXT_PUBLIC_API_URL` mit demselben Port (Muster wie
      // `foundation.spec.ts`).
      const apiOrigin = `http://localhost:${process.env.PLAYWRIGHT_API_PORT ?? 3_101}/api/v1`;
      // CORS-Preflights (`OPTIONS`) werden bewusst NICHT separat gezaehlt:
      // ein gezielter Vorabtest (Fetch mit `Authorization` plus einem
      // zusaetzlichen, nicht erlaubten Header auf eine frische Seite ohne
      // jede vorherige Anfrage) erzeugte serverseitig nachweislich einen
      // Preflight, `page.on("request")` meldete dafuer aber kein `OPTIONS`-
      // Ereignis -- Playwright/Chromium geben vom Browser selbst erzeugte
      // CORS-Preflights ueber dieses Ereignis nicht zuverlaessig weiter. Eine
      // Zaehlung waere damit nicht belegbar. Fuer das Rate-Limit selbst ist
      // das ohne Belang: `app.enableCors(...)` registriert NestJS/Fastify vor
      // `registerRateLimit(...)` (`configure-application.ts`), ein Preflight
      // bekommt seine Antwort also bereits dort und erreicht den
      // Rate-Limit-Hook nie.
      let requestCount = 0;
      const onRequest = (request: Request) => {
        if (!request.url().startsWith(apiOrigin)) return;
        if (request.method() === "OPTIONS") return;
        requestCount += 1;
      };
      tabletPage.on("request", onRequest);

      // Admin: Turnier anlegen und das Match der Scheibe zuweisen -- danach
      // laeuft das Match auf dem Tablet, ohne dass dort schon jemand etwas
      // eingibt.
      await page.goto(`/turniere/neu?organisation=${organizationId}`);
      await page.getByLabel("Format").selectOption("ROUND_ROBIN");
      await page.getByLabel("Name").fill(tournamentName);
      await page.getByLabel("Best of Legs").selectOption("1");
      await Promise.all([
        page.waitForURL(/\/turniere\/[^/?]+\?organisation=/u),
        page.getByRole("button", { name: "Turnier starten" }).click(),
      ]);
      await expect(page.getByRole("heading", { level: 1, name: tournamentName })).toBeVisible();
      await page.getByRole("button", { name: `Auf ${boardName} starten` }).click();
      await expect(page.getByRole("heading", { level: 3, name: boardName })).toBeVisible();

      await expect(tabletPage.getByRole("region", { name: "Match-Scoreboard" })).toBeVisible({
        timeout: 10_000,
      });
      await decideLegStart(tabletPage);
      await switchInputMode(tabletPage, "Runde");

      // Messfenster 1: Match laeuft, keine Eingaben am Tablet. 30s wie im
      // Brief -- bei einer nominell zweistelligen Anfragenzahl pro Fenster
      // ist eine einzelne Anfrage Unterschied beim Hochrechnen auf eine
      // Minute kein nennenswertes Rauschen.
      requestCount = 0;
      await tabletPage.waitForTimeout(30_000);
      const matchPerMinute = requestCount * 2;
      console.log(`Match-Phase: ${requestCount} Anfragen/30s (${matchPerMinute}/min, ohne OPTIONS)`);

      // Leg zuegig beenden (wie im ersten Fall dieser Datei): 180 / 0 / 180 /
      // 0 / 141 (Checkout T20 T19 D12) -- diese Eingaben liegen bewusst
      // AUSSERHALB der beiden Messfenster.
      const record = async (
        score: number,
        checkout?: { readonly field: number; readonly darts: 1 | 2 | 3 },
      ) => {
        await typeRoundScore(tabletPage, score);
        if (checkout === undefined) {
          await expect(
            tabletPage.getByRole("button", { name: /^(Fehlwurf|Ziffer 0)$/u }).first(),
          ).toBeEnabled();
          return;
        }
        const dialog = tabletPage.getByRole("dialog", { name: "Checkout erfassen" });
        await expect(dialog).toBeVisible();
        await dialog.getByLabel("Checkout-Feld").selectOption(String(checkout.field));
        await selectCheckoutDarts(dialog, checkout.darts);
        await dialog.getByRole("button", { name: "Checkout speichern" }).click();
      };
      await record(180);
      await record(0);
      await record(180);
      await record(0);
      await record(141, { field: 12, darts: 3 });

      await expect(tabletPage.getByText("Match beendet")).toBeVisible({ timeout: 15_000 });
      const weiterButton = tabletPage.getByRole("button", { name: "Weiter" });
      await expect(weiterButton).toBeVisible({ timeout: 15_000 });
      await weiterButton.click();
      await expect(tabletPage.getByText(`${boardName} – wartet auf nächstes Match`)).toBeVisible({
        timeout: 10_000,
      });

      // Messfenster 2: Leerlauf, keine Eingaben. 60s statt 30s: die
      // Leerlauf-Grenze (<= 15/min) liegt mit nominell rund 6 Anfragen pro
      // 30s so knapp an der Hochrechnung (7 statt 6 waeren bereits 14/min,
      // 8 schon 16/min), dass ein einzelnes zusaetzliches Poll am
      // Fensterrand den Fall faelschlich rot faerben koennte. Ueber 60s
      // gemessen zaehlt die rohe Anzahl direkt als Anfragen pro Minute, ohne
      // Verdopplung und ohne dieses Rundungsrisiko.
      requestCount = 0;
      await tabletPage.waitForTimeout(60_000);
      const idlePerMinute = requestCount;
      console.log(`Leerlauf-Phase: ${idlePerMinute} Anfragen/min (ohne OPTIONS)`);

      tabletPage.off("request", onRequest);

      // Grenzen aus dem Brief: im Match 30-60/min, im Leerlauf 8-15/min
      // (jeweils ohne OPTIONS-Preflights). Die Untergrenzen sind ein eigener
      // Befund wert: faellt die Zahl darunter, hat entweder der URL-Filter
      // (`apiOrigin`) aufgehoert zu greifen oder das Polling ist ausgefallen
      // -- ein stummes "0 Anfragen" waere sonst ebenso gruen wie ein
      // korrekter Lauf.
      expect(matchPerMinute).toBeGreaterThanOrEqual(30);
      expect(matchPerMinute).toBeLessThanOrEqual(60);
      expect(idlePerMinute).toBeGreaterThanOrEqual(8);
      expect(idlePerMinute).toBeLessThanOrEqual(15);
    } finally {
      await tabletContext.close();
    }
  },
);
