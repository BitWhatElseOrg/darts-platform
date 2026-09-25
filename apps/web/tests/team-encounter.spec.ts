import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { randomUUID } from "node:crypto";

import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";
import { recordDartVisit, selectCheckoutDarts, switchInputMode, typeRoundScore } from "./scoreboard-entry";
import { signUpWithOrganization } from "./sign-up";

/**
 * Der Browser-Test der Team-Begegnung (Spec-Abschnitt „Browser-Tests"):
 * ansetzen, beide Meldungen erfassen, zwei Spiele parallel auf zwei Boards,
 * Doppelpaarungen vor dem Doppel melden, ein Doppel ausspielen, Ergebnis
 * prüfen.
 *
 * Der Wettbewerb hat zwei Aufstellungspositionen und ein reguläres Doppel,
 * also sechs Spiele statt neunzehn. Die Reglementsregeln bleiben die echten:
 * 501 beziehungsweise 701, Double In, Double Out.
 */

const registrationSeeds: RegistrationInvitationSeed[] = [];

const HOME_PLAYERS = ["Heim Eins", "Heim Zwei", "Heim Drei"] as const;
const AWAY_PLAYERS = ["Gast Eins", "Gast Zwei", "Gast Drei"] as const;

const SLOT_SINGLES_ONE = "Einzel 1 · Heim 1 gegen Gast 1";
const SLOT_SINGLES_TWO = "Einzel 2 · Heim 2 gegen Gast 2";
const SLOT_DOUBLES = "Doppel 1";
const SLOT_SINGLES_THREE = "Einzel 3 · Heim 1 gegen Gast 2";
const SLOT_SINGLES_FOUR = "Einzel 4 · Heim 2 gegen Gast 1";
const SLOT_DECIDER = "Entscheidungsdoppel";

interface Checkout {
  readonly field: number;
  readonly darts: 1 | 2 | 3;
}

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

/**
 * Zwei Eingaben derselben Formularzeile stehen auf einer Linie, auch wenn nur
 * eine von beiden einen Hinweis oder eine Fehlermeldung unter sich trägt.
 *
 * Ohne `FieldRow` richtet das Raster die Kästen aus statt der Eingaben: das
 * Feld mit der Notiz ist höher, seine Eingabe rutschte deshalb auf «Team
 * anlegen» dauerhaft eine Zeile über den Namen.
 */
async function expectAlignedRow(page: Page, first: string, second: string): Promise<void> {
  const firstBox = await page.getByLabel(first, { exact: true }).boundingBox();
  const secondBox = await page.getByLabel(second, { exact: true }).boundingBox();
  if (firstBox === null || secondBox === null) {
    throw new Error(`Expected both ${first} and ${second} to be laid out.`);
  }
  expect(secondBox.y, `${first} und ${second} auf einer Linie`).toBeCloseTo(firstBox.y, 0);
}

function slotRow(page: Page, label: string): Locator {
  return page
    .getByRole("region", { name: "Spiele der Begegnung" })
    .getByRole("listitem")
    .filter({ hasText: label });
}

/**
 * Der Spielabend liegt bewusst in der nahen Zukunft und ist nicht fest
 * verdrahtet.
 *
 * Der Server loest den Kader einer Begegnung zu ihrem TERMIN auf
 * (`encounters.repository.ts#loadSquad`, Spielberechtigung am Spieltag). Die
 * Personen dieses Falls werden waehrend des Laufs in die Mannschaft
 * aufgenommen, ihre Zugehoerigkeit beginnt also jetzt. Hier stand bis
 * 2026-09-15 fest `2026-09-10T20:00`: sobald dieses Datum in der
 * Vergangenheit lag, war der Kader am Spieltag leer und die Meldung wurde mit
 * PLAYER_NOT_IN_SQUAD abgelehnt — ein Fall, der an einem Stichtag von selbst
 * rot wird.
 */
function upcomingFixtureSlot(): string {
  const slot = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  slot.setHours(20, 0, 0, 0);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${slot.getFullYear()}-${pad(slot.getMonth() + 1)}-${pad(slot.getDate())}T${pad(slot.getHours())}:${pad(slot.getMinutes())}`;
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
  // Der Zustand der Seite wechselt auf „gemeldet"; ob die Namen dabei sichtbar
  // werden, entscheidet die Gegenseite (Reglement 2.1.1).
  await expect(panel.getByText("gemeldet", { exact: true })).toBeVisible();
}

async function reportDoublesPairing(
  page: Page,
  side: "Heim" | "Gast",
  pair: readonly [string, string],
): Promise<void> {
  const panel = page.getByRole("region", { name: new RegExp(`^Doppel ${side}`, "u") });
  await panel.getByLabel("Person 1").selectOption({ label: pair[0] });
  await panel.getByLabel("Person 2").selectOption({ label: pair[1] });
  await panel.getByRole("button", { name: "Paarung melden" }).click();
  await expect(panel).toContainText(`${SLOT_DOUBLES}: ${pair[0]} und ${pair[1]}`);
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
  await expect(row).toContainText(`${winner} gewinnt kampflos`);
}

/**
 * Die Steuerung eines Boards gehört dem Gerät, das den Lease hält. Ein
 * früherer Besuch derselben Seite kann ihn noch halten; die Fläche bietet
 * dafür „Steuerung übernehmen" an.
 */
async function openScoreboard(page: Page, label: string): Promise<void> {
  await slotRow(page, label).getByRole("link", { name: "Scoreboard" }).click();
  await expect(page.getByRole("region", { name: "Match-Scoreboard" })).toBeVisible();
  const takeOver = page.getByRole("button", { name: "Steuerung übernehmen" });
  // Geprueft wird eine gewoehnliche Taste des jeweils gezeigten Keypads
  // ("Fehlwurf" im Dart-, "Ziffer 0" im Rundenmodus): sie ist wie jede andere
  // gesperrt, solange dieses Geraet die Boardsteuerung nicht haelt. Die
  // frühere Pruefung ueber "Rücktaste" traegt das nicht mehr — die Taste
  // heisst bei leerer Eingabe nach der Aufnahme, die sie zuruecknehmen wuerde,
  // und ist ohne eine solche Aufnahme gesperrt, obwohl das Keypad lebt
  // (`backspace-key.tsx`).
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

async function record(page: Page, points: number, checkout?: Checkout): Promise<void> {
  await typeRoundScore(page, points);
  if (checkout === undefined) {
    // Nach erfolgreicher Übernahme wechselt der Wurf zur Gegenseite; hat die
    // unter Double In noch nicht eröffnet, zeigt die Fläche statt des
    // Rundenfelds das Dart-Keypad (match-scoreboard.tsx, `dartEntryRequired`,
    // round-entry.ts `requiresDartEntry`) — "Ziffer 0" gibt es dann gar nicht
    // mehr, ein Warten allein darauf war in CI einmal rot (PR #73), lokal
    // grün nur, weil der Refetch das Rennen meist gewann. Die Prüfung greift
    // deshalb wie `openScoreboard` auf eine gewöhnliche Taste des jeweils
    // gezeigten Keypads zurück ("Fehlwurf" im Dart-, "Ziffer 0" im
    // Rundenmodus): beide aktivieren erst, wenn das Absenden vorbei ist
    // (nicht mehr `submitPending`). Dass die Aufnahme dabei tatsächlich
    // übernommen wurde, weisen die Aufrufer im Anschluss über den Restscore
    // nach.
    const anyPlainKey = page.getByRole("button", { name: /^(Fehlwurf|Ziffer 0)$/u });
    await expect(anyPlainKey.first()).toBeEnabled();
    return;
  }
  const dialog = page.getByRole("dialog", { name: "Checkout erfassen" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Checkout-Feld").selectOption(String(checkout.field));
  await selectCheckoutDarts(dialog, checkout.darts);
  await dialog.getByRole("button", { name: "Checkout speichern" }).click();
  await expect(page.getByText("Match beendet")).toBeVisible();
}

/**
 * Eine Aufnahme einer Seite, die im laufenden Leg noch nicht eröffnet hat.
 * Unter Double In zeigt die Fläche dafür auch im Runden-Modus das
 * Dart-Keypad (`round-entry.ts`, `requiresDartEntry`) — aus einer
 * Rundensumme sind die Punkte vor dem eröffnenden Doppel nicht zählbar, die
 * Engine lehnt sie ab (`DARTS_REQUIRED_FOR_DOUBLE_IN`).
 */
async function openWithDouble(page: Page): Promise<void> {
  // D20 + T20 = 100, eröffnet auf dem Doppel; der dritte Wurf schliesst die
  // Aufnahme ab, ohne zu zählen.
  await recordDartVisit(page, ["D20", "T20", "MISS"]);
}

/** Drei Fehlwürfe: die Seite eröffnet nicht und bleibt beim Dart-Keypad. */
async function missVisit(page: Page): Promise<void> {
  await recordDartVisit(page, ["MISS", "MISS", "MISS"]);
}

/**
 * 501 Double In / Double Out auf einen Gewinnsatz. Die Eröffnungsaufnahme
 * läuft Wurf für Wurf, danach zählt das Ziffernfeld weiter. Die Gastseite
 * eröffnet nie und wirft deshalb durchgehend Fehlwürfe; eine Null öffnet
 * nicht und muss es nicht.
 */
async function playSingles(page: Page, homeName: string): Promise<void> {
  const homeScore = page.getByLabel(`${homeName}, Restscore`);
  await openWithDouble(page);
  await expect(homeScore).toHaveText("401");
  await missVisit(page);
  await record(page, 180);
  await expect(homeScore).toHaveText("221");
  await missVisit(page);
  await record(page, 180);
  await expect(homeScore).toHaveText("41");
  await missVisit(page);
  await record(page, 41, { field: 16, darts: 2 });
  await expect(page.getByText(`${homeName} gewinnt`)).toBeVisible();
}

/**
 * 701 Double In / Double Out. Die werfende Person wechselt innerhalb der
 * Heimseite von Aufnahme zu Aufnahme; die Fläche schickt sie selbst mit.
 * Genau dadurch prüft der Fall die Doppelrotation.
 */
async function playDoubles(page: Page, homeNames: string): Promise<void> {
  const homeScore = page.getByLabel(`${homeNames}, Restscore`);
  await openWithDouble(page);
  await expect(homeScore).toHaveText("601");
  await missVisit(page);
  await record(page, 180);
  await expect(homeScore).toHaveText("421");
  await missVisit(page);
  await record(page, 180);
  await expect(homeScore).toHaveText("241");
  await missVisit(page);
  await record(page, 180);
  await expect(homeScore).toHaveText("61");
  await missVisit(page);
  await record(page, 61, { field: 18, darts: 2 });
  await expect(page.getByText(`${homeNames} gewinnt`)).toBeVisible();
}

test("a club plays a team encounter from the fixture to the result", async ({ browser, page }) => {
  test.slow();
  test.setTimeout(360_000);

  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-liga-${suffix}@example.test`;
  const homeTeam = `E2E Heim ${short}`;
  const awayTeam = `E2E Gast ${short}`;
  const competitionName = `E2E Liga ${short}`;
  const boardOne = `E2E Board A ${short}`;
  const boardTwo = `E2E Board B ${short}`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);

  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken,
    email,
    organizationName: `E2E Liga Club ${short}`,
    organizationSlug: `e2e-liga-club-${suffix}`,
    ownerName: "E2E Ligaleitung",
  });

  // Sechs Personen, zwei Kader zu drei.
  await page.goto(`/spieler?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Spieler & Team" })).toBeVisible();
  for (const name of [...HOME_PLAYERS, ...AWAY_PLAYERS]) await addPlayer(page, name);

  await page.goto(`/teams?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible();
  await expectAlignedRow(page, "Name", "Kurzname");
  await createTeam(page, { name: homeTeam, shortName: "EHE", members: HOME_PLAYERS });
  await createTeam(page, { name: awayTeam, shortName: "EGA", members: AWAY_PLAYERS });

  // Zwei Boards, damit zwei Spiele gleichzeitig laufen können.
  await page.goto(`/matches?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
  await addBoard(page, boardOne);
  await addBoard(page, boardTwo);

  // Wettbewerb: zwei Aufstellungspositionen, ein Doppel, Best of 1.
  await page.goto(`/liga?organisation=${organizationId}`);
  await page.getByRole("link", { name: "Wettbewerb anlegen", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Wettbewerb anlegen" })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(competitionName);
  await page.getByLabel("Aufstellungspositionen").selectOption("2");
  await page.getByLabel("Reguläre Doppel", { exact: true }).selectOption("1");
  await page.getByLabel("Distanz je Spiel").selectOption("1");
  await page.getByLabel("Mindestmeldung").fill("3");
  await page.getByLabel("Ausnahmemeldung").fill("2");
  await expect(page.getByRole("table")).toContainText(SLOT_DECIDER);
  await Promise.all([
    page.waitForURL(/\/liga\/[0-9a-f-]{36}\?organisation=/u),
    page.getByRole("button", { name: "Wettbewerb anlegen" }).click(),
  ]);

  const competitionUrl = page.url();
  await expect(page.getByRole("heading", { level: 1, name: competitionName })).toBeVisible();
  // Der Kurzname wird aus dem Namen vorgeschlagen, solange das Feld unberührt bleibt.
  await expect(page.getByText(`e2e-liga-${short} · 6 Spiele je Begegnung`)).toBeVisible();
  await expect(page.getByText("Begegnungsvorlage · 6 Spiele")).toBeVisible();

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
  await expect(page.getByText("0 von 6 Spielen entschieden")).toBeVisible();

  // Beide Meldungen. Die gegnerische bleibt verdeckt, bis beide vorliegen.
  await nominate(page, "Heim", HOME_PLAYERS);
  await expect(page.getByRole("region", { name: /^Meldung Heim/u })).toContainText(
    "Die Aufstellung wird sichtbar, sobald beide Seiten gemeldet haben",
  );
  await expect(page.getByText("Es fehlt noch die Meldung der Gastmannschaft.")).toBeVisible();

  await nominate(page, "Gast", AWAY_PLAYERS);
  await expect(page.getByRole("region", { name: /^Meldung Heim/u })).toContainText(HOME_PLAYERS[0]);
  await expect(page.getByRole("region", { name: /^Meldung Gast/u })).toContainText(AWAY_PLAYERS[0]);

  // Vor dem Start ist kein Spiel zuweisbar.
  await expect(slotRow(page, SLOT_SINGLES_ONE)).toContainText(
    "Die Begegnung ist noch nicht gestartet.",
  );
  await page.getByRole("button", { name: "Begegnung starten" }).click();
  await expect(
    page.getByText("Weise Spiele einem Board zu, sobald beide Seiten besetzt sind."),
  ).toBeVisible();

  // Zwei Spiele parallel auf zwei Boards.
  await assignSlot(page, SLOT_SINGLES_ONE, boardOne);
  await assignSlot(page, SLOT_SINGLES_TWO, boardTwo);
  await expect(slotRow(page, SLOT_SINGLES_ONE)).toContainText(boardOne);
  await expect(slotRow(page, SLOT_SINGLES_TWO)).toContainText(boardTwo);
  await expect(page.getByText("0 von 6 Spielen entschieden, 2 laufen")).toBeVisible();

  await openScoreboard(page, SLOT_SINGLES_ONE);
  // Befund der Abschlussrunde: unter Double In — der Vorgabe jedes
  // voreingestellten Ligawettbewerbs (competition-setup.tsx) — laufen
  // geworfene und angerechnete Summe bis zur Eröffnung auseinander. Die
  // Fläche muss die GEWORFENE senden, sonst weist der Server die
  // Eröffnungsaufnahme ab (DART_SUM_MISMATCH) und die Wurf-für-Wurf-Eingabe
  // ist in der Liga unbedienbar. T20/T20/D20: 160 geworfen, 40 angerechnet.
  await page.getByRole("button", { name: "Umschalter TRIPLE" }).click();
  await page.getByRole("button", { name: "Triple 20", exact: true }).click();
  await page.getByRole("button", { name: "Umschalter TRIPLE" }).click();
  await page.getByRole("button", { name: "Triple 20", exact: true }).click();
  await page.getByRole("button", { name: "Umschalter DOUBLE" }).click();
  await page.getByRole("button", { name: "Doppel 20", exact: true }).click();
  await expect(page.getByText("ANGERECHNET")).toBeVisible();
  await expect(page.getByText("von 160 geworfen")).toBeVisible();
  await page.getByRole("button", { name: "WEITER" }).click();
  await expect(page.getByLabel(`${HOME_PLAYERS[0]}, Restscore`)).toHaveText("461");
  // Zurücknehmen: das Leg beginnt danach von vorn. Die Eröffnungsaufnahme
  // läuft in jedem Fall Wurf für Wurf (`playSingles`, `openWithDouble`),
  // erst danach zählt das Ziffernfeld des Runden-Modus weiter.
  await page.getByRole("button", { name: "Letzte Aufnahme zurücknehmen: 40 Punkte" }).click();
  await expect(page.getByLabel(`${HOME_PLAYERS[0]}, Restscore`)).toHaveText("501");
  // Der Rundenmodus bleibt geräte-/browserlokal gespeichert (`localStorage`)
  // und damit über jede weitere Navigation und jedes weitere Board dieses
  // Tests hinweg bestehen — ein einmaliger Wechsel genügt. Der
  // Wurf-für-Wurf-Modus samt dem Moduswechsel selbst ist eigens in
  // scoreboard.spec.ts abgedeckt.
  await switchInputMode(page, "Runde");
  await playSingles(page, HOME_PLAYERS[0]);
  await page.goto(encounterUrl);
  await openScoreboard(page, SLOT_SINGLES_TWO);
  await playSingles(page, HOME_PLAYERS[1]);
  await page.goto(encounterUrl);

  await expect(slotRow(page, SLOT_SINGLES_ONE)).toContainText("gespielt");
  await expect(slotRow(page, SLOT_SINGLES_TWO)).toContainText("gespielt");

  // Die Doppelpaarungen werden erst am Abend gemeldet — vor dem Doppelslot.
  await expect(slotRow(page, SLOT_DOUBLES)).toContainText(
    "Heim hat die Doppelpaarung noch nicht gemeldet.",
  );
  await reportDoublesPairing(page, "Heim", [HOME_PLAYERS[0], HOME_PLAYERS[2]]);
  await expect(slotRow(page, SLOT_DOUBLES)).toContainText(
    "Gast hat die Doppelpaarung noch nicht gemeldet.",
  );
  await reportDoublesPairing(page, "Gast", [AWAY_PLAYERS[0], AWAY_PLAYERS[2]]);

  await assignSlot(page, SLOT_DOUBLES, boardOne);
  await openScoreboard(page, SLOT_DOUBLES);
  await playDoubles(page, `${HOME_PLAYERS[0]} und ${HOME_PLAYERS[2]}`);
  await page.goto(encounterUrl);
  await expect(slotRow(page, SLOT_DOUBLES)).toContainText("gespielt");

  // Die beiden übrigen Einzel gehen kampflos an den Gast (Reglement 2.2.6).
  await walkover(page, SLOT_SINGLES_THREE, "Gast", "nicht an der Abwurflinie erschienen");
  await walkover(page, SLOT_SINGLES_FOUR, "Gast", "nicht an der Abwurflinie erschienen");

  // Ergebnis: 3:2 Spiele für Heim, 3:0 Punkte, kein Entscheidungsdoppel.
  const scoreline = page.locator("header").filter({ hasText: "Punkte" });
  await expect(scoreline).toContainText("beendet");
  await expect(scoreline).toContainText("3:0");
  await expect(scoreline).toContainText("3:2");
  await expect(scoreline.getByText("Heim gewinnt", { exact: true })).toBeVisible();
  await expect(page.getByText("5 von 5 Spielen entschieden")).toBeVisible();
  await expect(slotRow(page, SLOT_DECIDER)).toContainText("entfällt");
  await expect(page.getByText("Das Entscheidungsdoppel wird nicht gebraucht.")).toBeVisible();

  // Einzelrangliste auf der Wettbewerbsübersicht (reine Domänenlogik in
  // `player-ranking.ts`, Reglement A1.6–A1.9). Sie zählt nur Einzel, nie
  // Doppel — aber sowohl gespielte als auch kampflos gewertete Slots
  // (`calculatePlayerRanking`: übersprungen wird nur, was weder COMPLETED
  // noch WALKOVER ist). Unter zwei Aufstellungspositionen bestreitet jede
  // Position im Rundenturnier (`buildEncounterTemplate`) genau ein
  // gespieltes Einzel und ein Nichtantritt-Einzel: Heim 1 (`HOME_PLAYERS[0]`)
  // spielt SLOT_SINGLES_ONE und steht kampflos in SLOT_SINGLES_THREE, Heim 2
  // (`HOME_PLAYERS[1]`) spiegelbildlich bei SLOT_SINGLES_TWO/-FOUR. Sieg
  // (2 von 2 möglichen Ranglistenpunkten) und Nichtantritt-Niederlage (0 von
  // 2) gleichen sich für beide exakt aus: 2 Spiele, 1 Sieg, 1 Niederlage,
  // Trefferquote 50,0 %, 1.00 Ranglistenpunkte (erzielte² / mögliche = 2² / 4
  // laut `bookSide`/`calculatePlayerRanking`). Aus demselben Grund kommen
  // Gast 1 und Gast 2 rechnerisch auf dasselbe Ergebnis — alle vier
  // Einzelspieler dieser Fixture liegen damit gleichauf auf Rang 1: der
  // Rangwert selbst (1) ist vollständig deterministisch und wird unten
  // geprüft. NICHT deterministisch ist dagegen die Zeilenreihenfolge unter
  // den Gleichgestellten — die bricht `compareRows`/`.sort(...)` über die
  // `playerId`, eine interne UUID, die der Test nicht im Voraus kennt.
  await page.goto(competitionUrl);
  const rankingSection = page.getByRole("region", { name: "Einzelrangliste" });
  await expect(rankingSection.getByRole("heading", { name: "Einzelrangliste" })).toBeVisible();
  const rankingTable = rankingSection.getByRole("table");
  await expect(rankingTable).toBeVisible();

  for (const homeName of [HOME_PLAYERS[0], HOME_PLAYERS[1]]) {
    const row = rankingTable.locator("tbody tr").filter({ hasText: homeName });
    await expect(row).toBeVisible();
    const cells = row.locator("td");
    await expect(cells.nth(0)).toHaveText("1"); // Rang: alle vier gleichauf (siehe Kommentar oben)
    await expect(cells.nth(2)).toHaveText("2"); // Sp: gespieltes Einzel + Nichtantritt
    await expect(cells.nth(3)).toHaveText("1"); // S
    await expect(cells.nth(4)).toHaveText("1"); // N
    await expect(cells.nth(5)).toHaveText("50.0%"); // Quote
    await expect(cells.nth(6)).toHaveText("1.00"); // Rangl.-Pkt.
  }

  // Heim 3 (`HOME_PLAYERS[2]`) bestreitet in dieser Fixture ausschliesslich
  // das Doppel (siehe `reportDoublesPairing`/`playDoubles` oben) — nie ein
  // Einzel. Die günstigste End-zu-End-Bestätigung dafür, dass „nur Einzel
  // zählen" wirklich durch den gesamten Stack (Repository → Service →
  // Engine → API → UI) trägt: keine Zeile für Heim 3 in der Tabelle.
  await expect(
    rankingTable.locator("tbody tr").filter({ hasText: HOME_PLAYERS[2] }),
  ).toHaveCount(0);
  await page.goto(encounterUrl);

  // Dieselbe Begegnung öffentlich, ohne Anmeldung.
  const publicHref = await page
    .getByRole("link", { name: "Öffentliche Live-Ansicht" })
    .getAttribute("href");
  if (publicHref === null) throw new Error("Expected a public live link on the encounter page.");
  const anonymous = await browser.newContext();
  try {
    const publicPage = await anonymous.newPage();
    await publicPage.goto(publicHref);
    await expect(
      publicPage.getByRole("heading", { level: 1, name: `${homeTeam} gegen ${awayTeam}` }),
    ).toBeVisible();
    const tally = publicPage.getByRole("region", { name: "Zwischenstand" });
    await expect(tally).toContainText("3:0");
    await expect(tally).toContainText("Heim gewinnt");
  } finally {
    await anonymous.close();
  }
});
