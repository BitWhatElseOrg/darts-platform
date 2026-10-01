import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { randomUUID } from "node:crypto";

import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";
import { switchInputMode, typeRoundScore } from "./scoreboard-entry";
import { signUpWithOrganization } from "./sign-up";

/**
 * Spec 2026-10-01-liga-resultatkorrektur, Abschnitt 5 „E2E": eine Begegnung
 * wird zu Ende gespielt, das letzte gespielte Spiel wird korrigiert, neu
 * gescort — diesmal mit umgekehrtem Sieger —, und die Begegnung schliesst
 * erneut ab. Die Ligatabelle zeigt danach das neue Resultat.
 *
 * Aufbau nach dem Muster aus `team-encounter.spec.ts`, aber auf das Nötigste
 * verkürzt: ein einziges Board, Straight In/Single Out, Startscore 301, Best
 * of 1 (wie die API-Integration `encounter-correction.integration.spec.ts`)
 * — unter Single Out schliesst jede Rundensumme, die genau auf den Reststand
 * trifft, direkt ab, ohne Checkout-Dialog (`match-scoreboard.tsx`,
 * `handleRoundSubmit`). Vier der sechs Spiele der Begegnung gehen kampflos
 * durch, nur das erste Einzel wird tatsächlich gescort — das spart die drei
 * übrigen, für diesen Fall belanglosen Partien.
 */

const registrationSeeds: RegistrationInvitationSeed[] = [];

const HOME_PLAYERS = ["Heim Eins", "Heim Zwei", "Heim Drei"] as const;
const AWAY_PLAYERS = ["Gast Eins", "Gast Zwei", "Gast Drei"] as const;

const SLOT_SINGLES_ONE = "Einzel 1 · Heim 1 gegen Gast 1";
const SLOT_SINGLES_TWO = "Einzel 2 · Heim 2 gegen Gast 2";
const SLOT_DOUBLES = "Doppel 1";
const SLOT_SINGLES_THREE = "Einzel 3 · Heim 1 gegen Gast 2";
const SLOT_SINGLES_FOUR = "Einzel 4 · Heim 2 gegen Gast 1";

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

/**
 * Der Spielabend liegt bewusst in der nahen Zukunft und ist nicht fest
 * verdrahtet (`loadSquad`/Spielberechtigung am Spieltag, Memory „Kader zum
 * Spieltag" — siehe `team-encounter.spec.ts` für die ausführliche
 * Begründung).
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

function standingsCells(page: Page, teamName: string): Locator {
  return page
    .getByRole("region", { name: "Tabelle" })
    .getByRole("table")
    .locator("tbody tr")
    .filter({ hasText: teamName })
    .locator("td");
}

async function addPlayer(page: Page, displayName: string): Promise<void> {
  await page.getByLabel("Anzeigename", { exact: true }).fill(displayName);
  await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
  await expect(page.getByText(displayName, { exact: true }).first()).toBeVisible();
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

async function addBoard(page: Page, name: string): Promise<void> {
  await page.getByLabel("Neues Board").fill(name);
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await expect(
    page.locator("li").filter({ hasText: name }).filter({ hasText: "frei" }),
  ).toBeVisible();
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

async function walkover(
  page: Page,
  label: string,
  winner: "Heim" | "Gast",
  reason: string,
): Promise<void> {
  const row = slotRow(page, label);
  await row.locator("summary").click();
  await row.getByLabel("Sieger").selectOption({ label: winner });
  await row.getByLabel("Begründung").fill(reason);
  await row.locator('button[type="submit"]').filter({ hasText: "Kampflos werten" }).click();
  await expect(row).toContainText("kampflos");
}

/**
 * Die Steuerung eines Boards gehört dem Gerät, das den Lease hält (siehe
 * `team-encounter.spec.ts`, derselbe Grund). Die Fläche startet unabhängig
 * von der In-Regel im Dart-Modus (`scoreboard-settings.ts`, Standard "DART");
 * der Wechsel auf „Runde" passiert erst danach. Geprüft wird deshalb eine
 * gewöhnliche Taste des jeweils gezeigten Keypads, wie in
 * `team-encounter.spec.ts`.
 */
async function openScoreboard(page: Page, label: string): Promise<void> {
  await slotRow(page, label).getByRole("link", { name: "Scoreboard" }).click();
  await expect(page.getByRole("region", { name: "Match-Scoreboard" })).toBeVisible();
  const takeOver = page.getByRole("button", { name: "Steuerung übernehmen" });
  const anyPlainKey = page.getByRole("button", { name: /^(Fehlwurf|Ziffer 0)$/u });
  await expect
    .poll(
      async () => {
        if (await takeOver.isVisible()) await takeOver.click();
        return anyPlainKey.first().isEnabled();
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

/**
 * Eine Rundensumme, die das Leg nicht abschliesst: Reststand bleibt übrig,
 * die Fläche wartet auf die Übernahme, bevor die nächste Aufnahme folgt
 * (sonst liefe ein Folgeschritt gegen eine noch laufende Anfrage).
 */
async function scoreRound(page: Page, points: number): Promise<void> {
  await typeRoundScore(page, points);
  await expect(page.getByRole("button", { name: "Ziffer 0" })).toBeEnabled();
}

/**
 * Die abschliessende Rundensumme. Unter Single Out schliesst eine Summe, die
 * genau den Reststand trifft, das Leg direkt ab — kein Checkout-Dialog
 * (`match-scoreboard.tsx`, `handleRoundSubmit`).
 */
async function finishWithRound(page: Page, points: number, winnerName: string): Promise<void> {
  await typeRoundScore(page, points);
  await expect(page.getByText("Match beendet")).toBeVisible();
  await expect(page.getByText(`${winnerName} gewinnt`)).toBeVisible();
}

test("a club corrects the result of a completed league game", async ({ page }) => {
  test.slow();
  test.setTimeout(180_000);

  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-liga-korrektur-${suffix}@example.test`;
  const homeTeam = `E2E Korrektur Heim ${short}`;
  const awayTeam = `E2E Korrektur Gast ${short}`;
  const competitionName = `E2E Korrektur Liga ${short}`;
  const boardName = `E2E Korrektur Board ${short}`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);

  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken,
    email,
    organizationName: `E2E Korrektur Club ${short}`,
    organizationSlug: `e2e-liga-korrektur-club-${suffix}`,
    ownerName: "E2E Korrektur Ligaleitung",
  });

  await page.goto(`/spieler?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Spieler & Team" })).toBeVisible();
  for (const name of [...HOME_PLAYERS, ...AWAY_PLAYERS]) await addPlayer(page, name);

  await page.goto(`/teams?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible();
  await createTeam(page, { name: homeTeam, shortName: "EKH", members: HOME_PLAYERS });
  await createTeam(page, { name: awayTeam, shortName: "EKG", members: AWAY_PLAYERS });

  await page.goto(`/matches?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
  await addBoard(page, boardName);

  // Zwei Aufstellungspositionen, ein reguläres Doppel, Best of 1 — das
  // kleinstmögliche Begegnungsformat. Straight In/Single Out und Startscore
  // 301 (wie `encounter-correction.integration.spec.ts`) halten das einzige
  // tatsächlich gescorte Spiel kurz: eine Rundensumme schliesst unter Single
  // Out direkt ab, sobald sie den Reststand genau trifft.
  await page.goto(`/liga?organisation=${organizationId}`);
  await page.getByRole("link", { name: "Wettbewerb anlegen", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Wettbewerb anlegen" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(competitionName);
  await page.getByLabel("Aufstellungspositionen").selectOption("2");
  await page.getByLabel("Reguläre Doppel", { exact: true }).selectOption("1");
  await page.getByLabel("Distanz je Spiel").selectOption("1");
  await page.getByLabel("Startscore Einzel").selectOption("301");
  await page.getByLabel("In-Regel").selectOption("STRAIGHT");
  await page.getByLabel("Out-Regel").selectOption("SINGLE");
  await page.getByLabel("Mindestmeldung").fill("3");
  await page.getByLabel("Ausnahmemeldung").fill("2");
  await Promise.all([
    page.waitForURL(/\/liga\/[0-9a-f-]{36}\?organisation=/u),
    page.getByRole("button", { name: "Wettbewerb anlegen" }).click(),
  ]);
  const competitionUrl = page.url();
  await expect(page.getByRole("heading", { level: 1, name: competitionName })).toBeVisible();

  // Begegnung ansetzen.
  await page.getByLabel("Spieltag").fill("1");
  await page.getByLabel("Heim", { exact: true }).selectOption({ label: homeTeam });
  await page.getByLabel("Gast", { exact: true }).selectOption({ label: awayTeam });
  await page.getByLabel("Spielabend").fill(upcomingFixtureSlot());
  await page.getByLabel("Ort").fill("Clublokal");
  await Promise.all([
    page.waitForURL(/\/liga\/begegnungen\/[0-9a-f-]{36}\?organisation=/u),
    page.getByRole("button", { name: "Ansetzen" }).click(),
  ]);
  const encounterUrl = page.url();
  await expect(
    page.getByRole("heading", { level: 1, name: `${homeTeam} gegen ${awayTeam}` }),
  ).toBeVisible();

  await nominate(page, "Heim", HOME_PLAYERS);
  await nominate(page, "Gast", AWAY_PLAYERS);
  await page.getByRole("button", { name: "Begegnung starten" }).click();

  // Das erste Einzel wird gescort: Heim eröffnet, beide Seiten kommen auf
  // denselben Reststand (301 - 180 = 121), Heim schliesst als Erster ab und
  // gewinnt — der Fall, den die Korrektur gleich umkehrt.
  await assignSlot(page, SLOT_SINGLES_ONE, boardName);
  await openScoreboard(page, SLOT_SINGLES_ONE);
  await switchInputMode(page, "Runde");

  const homeScore = page.getByLabel(`${HOME_PLAYERS[0]}, Restscore`);
  const awayScore = page.getByLabel(`${AWAY_PLAYERS[0]}, Restscore`);
  await expect(homeScore).toHaveText("301");
  await scoreRound(page, 180);
  await expect(homeScore).toHaveText("121");
  await scoreRound(page, 180);
  await expect(awayScore).toHaveText("121");
  await finishWithRound(page, 121, HOME_PLAYERS[0]);

  await page.goto(encounterUrl);
  await expect(slotRow(page, SLOT_SINGLES_ONE)).toContainText("gespielt");

  // Die restlichen vier Spiele gehen kampflos durch — 2:2, das gescorte
  // Einzel entscheidet die Begegnung 3:2 für Heim, das Entscheidungsdoppel
  // entfällt (ungerade Spielzahl, kein Unentschieden möglich).
  await walkover(page, SLOT_SINGLES_TWO, "Heim", "nicht an der Abwurflinie erschienen");
  await walkover(page, SLOT_DOUBLES, "Heim", "nicht an der Abwurflinie erschienen");
  await walkover(page, SLOT_SINGLES_THREE, "Gast", "nicht an der Abwurflinie erschienen");
  await walkover(page, SLOT_SINGLES_FOUR, "Gast", "nicht an der Abwurflinie erschienen");

  const scoreline = page.locator("header").filter({ hasText: "Punkte" });
  await expect(scoreline).toContainText("beendet");
  await expect(scoreline).toContainText("3:0");
  await expect(scoreline).toContainText("3:2");
  await expect(scoreline.getByText("Heim gewinnt", { exact: true })).toBeVisible();

  // Tabelle vor der Korrektur: Heim siegt, Gast unterliegt.
  await page.goto(competitionUrl);
  await expect(standingsCells(page, homeTeam).nth(1)).toHaveText("1"); // Sp
  await expect(standingsCells(page, homeTeam).nth(2)).toHaveText("1"); // S
  await expect(standingsCells(page, homeTeam).nth(4)).toHaveText("0"); // N
  await expect(standingsCells(page, homeTeam).nth(5)).toHaveText("3:2"); // Spiele
  await expect(standingsCells(page, awayTeam).nth(2)).toHaveText("0"); // S
  await expect(standingsCells(page, awayTeam).nth(4)).toHaveText("1"); // N

  // Korrektur: Heims gewinnender Checkout war falsch erfasst.
  await page.goto(encounterUrl);
  const correctionRow = slotRow(page, SLOT_SINGLES_ONE);
  await correctionRow.getByRole("button", { name: "Resultat korrigieren" }).click();
  await correctionRow.getByLabel("Korrekturgrund").fill("Checkout falsch erfasst.");
  await correctionRow.getByRole("button", { name: "Korrektur starten" }).click();
  await expect(correctionRow).toContainText("läuft");
  await expect(scoreline).not.toContainText("gewinnt");

  // Neu gescort: das Spiel öffnet sich mit zurückgenommener letzter Aufnahme
  // — beide Seiten stehen wieder auf 121. Heim spielt diesmal nicht aus (ein
  // Fehlwurf wäre ebenso gültig, 60 bleibt bewusst ungenutzter Rest), Gast
  // schliesst mit der nächsten Aufnahme ab — der Sieger des Spiels wechselt.
  await openScoreboard(page, SLOT_SINGLES_ONE);
  await expect(homeScore).toHaveText("121");
  await expect(awayScore).toHaveText("121");
  await scoreRound(page, 60);
  await expect(homeScore).toHaveText("61");
  await finishWithRound(page, 121, AWAY_PLAYERS[0]);

  await page.goto(encounterUrl);
  await expect(slotRow(page, SLOT_SINGLES_ONE)).toContainText("gespielt");

  // Die Begegnung ist mit dem neuen Resultat erneut abgeschlossen: 2:3 Spiele
  // für Gast statt 3:2 für Heim.
  await expect(scoreline).toContainText("beendet");
  await expect(scoreline).toContainText("0:3");
  await expect(scoreline).toContainText("2:3");
  await expect(scoreline.getByText("Gast gewinnt", { exact: true })).toBeVisible();

  // Tabelle nach der Korrektur: das Resultat hat sich vollständig umgekehrt.
  await page.goto(competitionUrl);
  await expect(standingsCells(page, homeTeam).nth(2)).toHaveText("0"); // S
  await expect(standingsCells(page, homeTeam).nth(4)).toHaveText("1"); // N
  await expect(standingsCells(page, homeTeam).nth(5)).toHaveText("2:3"); // Spiele
  await expect(standingsCells(page, awayTeam).nth(2)).toHaveText("1"); // S
  await expect(standingsCells(page, awayTeam).nth(4)).toHaveText("0"); // N
  await expect(standingsCells(page, awayTeam).nth(5)).toHaveText("3:2"); // Spiele
});
