import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { createRegistrationInvitation, type RegistrationInvitationSeed } from "./registration-invitation";
import { decideLegStart, setScoreboardSwitch, switchInputMode, typeRoundScore } from "./scoreboard-entry";
import { signUpWithOrganization } from "./sign-up";

/**
 * Spec Vereinsduell (Plan 2): 5 Mitglieder gegen 4 Gäste. Die Gäste werden in
 * der Anlage per Schnellerfassung angelegt. Nach dem letzten Spiel von Runde 1
 * paart der Server Runde 2; die Vereinswertung steht im Banner.
 */
const registrationSeeds: RegistrationInvitationSeed[] = [];

/**
 * Opt-in-Bildschirmfotos für die Sichtprüfung: nur mit
 * `CLUB_DUEL_SCREENSHOTS=1`, sonst läuft der Fall unverändert. Achtung:
 * Playwright leert `test-results/` zu Beginn jedes Laufs.
 */
const screenshots = Boolean(process.env.CLUB_DUEL_SCREENSHOTS);
const screenshotDir = path.join(__dirname, "..", "test-results", "club-duel");

async function snap(page: Page, name: string): Promise<void> {
  if (!screenshots) return;
  await page.screenshot({ fullPage: true, path: path.join(screenshotDir, `${name}.png`) });
}

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

test("Vereinsduell: Gäste erfassen, Runde 1 spielen, Runde 2 erscheint", async ({ page }) => {
  test.slow();
  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-duell-${suffix}@example.test`;
  const boardName = `E2E Duell Board ${short}`;
  const tournamentName = `E2E Vereinsduell ${short}`;
  const guestClub = `DC Gast ${short}`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);
  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken,
    email,
    organizationName: `E2E Duell Club ${short}`,
    organizationSlug: `e2e-duell-club-${suffix}`,
    ownerName: `E2E Duell Leitung ${short}`,
  });

  await page.goto(`/spieler?organisation=${organizationId}`);
  const members = ["Eins", "Zwei", "Drei", "Vier", "Fünf"].map((index) => `E2E Heim ${index} ${short}`);
  for (const name of members) {
    await page.getByLabel("Anzeigename", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }

  await page.goto(`/matches?organisation=${organizationId}`);
  await page.getByLabel("Neues Board").fill(boardName);
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await expect(page.locator("li").filter({ hasText: boardName }).filter({ hasText: "frei" })).toBeVisible();

  await page.goto(`/turniere/neu?organisation=${organizationId}`);
  await page.getByLabel("Format").selectOption("CLUB_DUEL");
  // exact: «Gastspieler (ein Name pro Zeile)» enthält ebenfalls «Name».
  await page.getByLabel("Name", { exact: true }).fill(tournamentName);
  await page.getByLabel("Best of Legs", { exact: true }).selectOption("1");
  await page.getByLabel("Eigener Verein", { exact: true }).fill("VFC");
  await page.getByLabel("Gastverein", { exact: true }).fill(guestClub);
  const guests = ["Alpha", "Beta", "Gamma", "Delta"].map((index) => `E2E Gast ${index} ${short}`);
  await page.getByLabel("Gastspieler (ein Name pro Zeile)").fill(guests.join("\n"));
  await page.getByRole("button", { name: "Gastspieler erfassen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "4 Gastspieler erfasst." })).toBeVisible();
  for (const name of members) await page.getByRole("checkbox", { name, exact: true }).check();
  for (const name of guests) await expect(page.getByRole("checkbox", { name, exact: true })).toBeChecked();
  await page.getByLabel("Quali-Runden", { exact: true }).selectOption("2");
  await page.getByLabel("Finalrunde (Spieler je Verein)").selectOption("2");
  await expect(page.getByText("Spiele insgesamt", { exact: true })).toBeVisible();
  await snap(page, "01-anlage");
  // Das Formular sendet nicht auf Enter ab (Task 4) – immer über den Knopf.
  // Die Anlageseite selbst (/turniere/neu?organisation=…) passt sonst schon.
  await Promise.all([
    page.waitForURL(/\/turniere\/(?!neu\?)[^/?]+\?organisation=/u),
    page.getByRole("button", { name: "Turnier starten" }).click(),
  ]);
  const tournamentUrl = page.url();
  await expect(page.getByRole("region", { name: "Vereinswertung" })).toContainText(`VFC 0 : 0 ${guestClub}`);
  await expect(page.getByRole("tab", { name: "Runden", exact: true })).toBeVisible();
  // Alle Tabpanels bleiben gemountet; nur das sichtbare liegt im
  // Accessibility-Baum. Gesucht wird deshalb im aktiven Panel.
  const roundsPanel = page.getByRole("tabpanel", { name: "Runden" });
  await expect(roundsPanel.getByRole("heading", { name: "Runde 1", exact: true })).toBeVisible();
  await expect(roundsPanel.getByRole("heading", { name: "Runde 2", exact: true })).toHaveCount(0);
  // 5 Mitglieder gegen 4 Gäste: genau ein Mitglied pausiert in Runde 1.
  const pauseLine = roundsPanel.getByText(/^Pausieren: /u);
  await expect(pauseLine).toBeVisible();
  const pausedInRoundOne = ((await pauseLine.textContent()) ?? "").replace(/^Pausieren: /u, "").trim();
  expect(members).toContain(pausedInRoundOne);

  // Runde 1 hat vier Spiele (4 Gäste, ein Mitglied pausiert); jedes wird auf
  // dem Board gestartet und von der Scoring-Fläche aus beendet. Nach dem
  // Ausbullen wirft Sitz eins (= Seite A, Mitglied) zuerst und gewinnt.
  for (let played = 0; played < 4; played += 1) {
    await page.goto(tournamentUrl);
    const startButton = page.getByRole("button", { name: `Auf ${boardName} starten` });
    await startButton.click();
    await expect(startButton).toHaveCount(0);
    await page.goto(`/matches?organisation=${organizationId}`);
    await page.getByRole("link").filter({ hasText: "läuft" }).first().click();
    const scoreboard = page.getByRole("region", { name: "Match-Scoreboard" });
    await expect(scoreboard).toBeVisible();
    // Vereinskürzel neben dem Spielernamen (Task 7).
    await expect(scoreboard.getByText("VFC", { exact: true }).first()).toBeVisible();
    await decideLegStart(page);
    // Ein frischer Browserkontext startet im Dart-Modus mit bestätigten
    // Checkout-Darts. Beide Einstellungen gelten je Browserkontext, deshalb
    // nur beim ersten Match umstellen.
    if (played === 0) {
      await switchInputMode(page, "Runde");
      await setScoreboardSwitch(page, "Checkout-Darts bestätigen", false);
    }
    for (const points of [180, 0, 180, 0]) {
      await typeRoundScore(page, points);
      await expect(page.getByRole("button", { name: "Ziffer 0" })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Aufnahme erfassen" })).toBeDisabled();
    }
    if (played === 0 && screenshots) {
      // Telefonbreite: die Scoring-Fläche mitten im Match.
      const viewport = page.viewportSize();
      await page.setViewportSize({ width: 360, height: 780 });
      await snap(page, "05-scoreboard-360");
      if (viewport !== null) await page.setViewportSize(viewport);
    }
    await typeRoundScore(page, 141);
    const dialog = page.getByRole("dialog", { name: "Checkout erfassen" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Checkout-Feld").selectOption("12");
    await dialog.getByRole("button", { name: "Checkout speichern" }).click();
    await expect(page.getByText("Match beendet")).toBeVisible();
  }

  // Der Checkout des vierten Spiels paart Runde 2 serverseitig; Runde 1 wandert
  // unter «Frühere Runden» (als <summary>, nicht als Überschrift).
  await page.goto(tournamentUrl);
  const roundTwo = roundsPanel.getByRole("heading", { name: "Runde 2", exact: true });
  await expect(roundTwo).toBeVisible();
  await expect(roundsPanel.getByText("Runde 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Vereinswertung" })).toContainText(`VFC 4 : 0 ${guestClub}`);
  // Runde 2 hat wieder vier Spiele, und wer in Runde 1 pausierte, spielt jetzt.
  const roundTwoMatches = roundTwo.locator("xpath=..").getByRole("listitem");
  await expect(roundTwoMatches).toHaveCount(4);
  await expect(roundTwoMatches.filter({ hasText: pausedInRoundOne })).toHaveCount(1);
  await snap(page, "02-kommandozentrale-runde-1");
  await page.getByRole("tab", { name: "Rangliste", exact: true }).click();
  const standingsPanel = page.getByRole("tabpanel", { name: "Rangliste" });
  await standingsPanel.getByRole("radio", { name: "VFC", exact: true }).click();
  await expect(standingsPanel.getByRole("radio", { name: "VFC", exact: true })).toHaveAttribute("aria-checked", "true");
  // Seite VFC: vier Siege aus Runde 1, das pausierende Mitglied ohne Spiel.
  // Spalten: Rang, Name, Verein, Spiele, Siege, Quote, Legdiff./Spiel.
  const vfcTable = standingsPanel.getByRole("table", { name: "Rangliste VFC" });
  const vfcRows = vfcTable.locator("tbody").getByRole("row");
  await expect(vfcRows).toHaveCount(5);
  for (const name of members) {
    const cells = vfcRows.filter({ hasText: name }).getByRole("cell");
    const played = name === pausedInRoundOne ? "0" : "1";
    await expect(cells.nth(3)).toHaveText(played);
    await expect(cells.nth(4)).toHaveText(played);
    await expect(cells.nth(5)).toHaveText(name === pausedInRoundOne ? "0 %" : "100 %");
  }

  if (screenshots) {
    // Die Live-Ansicht ist erst nach der Freigabe erreichbar; die Adresse
    // steht danach im Link der Kommandozentrale.
    await page.getByRole("switch", { name: "Öffentliche Freigabe: NEIN" }).click();
    await expect(page.getByRole("switch", { name: "Öffentliche Freigabe: JA" })).toBeVisible();
    const liveHref = await page.getByRole("link", { name: "Öffentliche Live-Ansicht" }).first().getAttribute("href");
    if (liveHref === null) throw new Error("Expected a live link in the command centre navigation.");
    await page.goto(liveHref);
    await expect(page.getByRole("region", { name: "Vereinswertung" })).toBeVisible();
    await snap(page, "03-live-publikum");
    await page.goto(`${liveHref}/tv`);
    await expect(page.getByRole("heading", { name: "Laufende Spiele" })).toBeVisible();
    await snap(page, "04-live-tv");
  }
});
