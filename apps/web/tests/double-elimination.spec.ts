import { expect, test } from "./fixtures";
import { randomUUID } from "node:crypto";

import { createRegistrationInvitation, type RegistrationInvitationSeed } from "./registration-invitation";
import { decideLegStart, setScoreboardSwitch, switchInputMode, typeRoundScore } from "./scoreboard-entry";
import { signUpWithOrganization } from "./sign-up";

/**
 * Spec Doppel-K.-o.: vier Spieler, Tableau 4er, Best of Legs 1. Gespielt wird
 * über ein Board bis zum ersten Final; dort gewinnt der Finalist aus der
 * Verliererrunde (zweiter Teilnehmer, der Sieger der Gewinnerrunde steht
 * als Teilnehmer eins), damit das Final-Rückspiel entsteht.
 */
const registrationSeeds: RegistrationInvitationSeed[] = [];

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

test("Doppel-K.-o.: Verlierer-Finalist gewinnt das Final, Final-Rückspiel erscheint", async ({ page }) => {
  test.slow();
  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-doppelko-${suffix}@example.test`;
  const boardName = `E2E DKO Board ${short}`;
  const tournamentName = `E2E Doppel-K.-o. ${short}`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);
  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken,
    email,
    organizationName: `E2E DKO Club ${short}`,
    organizationSlug: `e2e-dko-club-${suffix}`,
    ownerName: `E2E DKO Leitung ${short}`,
  });

  await page.goto(`/spieler?organisation=${organizationId}`);
  const players = ["Eins", "Zwei", "Drei", "Vier"].map((index) => `E2E DKO ${index} ${short}`);
  for (const name of players) {
    await page.getByLabel("Anzeigename", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }

  await page.goto(`/matches?organisation=${organizationId}`);
  await page.getByLabel("Neues Board").fill(boardName);
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await expect(page.locator("li").filter({ hasText: boardName }).filter({ hasText: "frei" })).toBeVisible();

  await page.goto(`/turniere/neu?organisation=${organizationId}`);
  await page.getByLabel("Format").selectOption("DOUBLE_ELIMINATION");
  await page.getByLabel("Name", { exact: true }).fill(tournamentName);
  await page.getByLabel("Best of Legs", { exact: true }).selectOption("1");
  await page.getByLabel("K.-o.-Tableau").selectOption("4");
  for (const name of players) await page.getByRole("checkbox", { name, exact: true }).check();
  await Promise.all([
    page.waitForURL(/\/turniere\/(?!neu\?)[^/?]+\?organisation=/u),
    page.getByRole("button", { name: "Turnier starten" }).click(),
  ]);
  const tournamentUrl = page.url();
  let switched = false;

  const nextUp = async (): Promise<{ first: string; second: string; label: string }> => {
    const heading = page.getByText("Nächstes Match", { exact: true });
    await expect(heading).toBeVisible();
    const names = ((await heading.locator("xpath=following-sibling::p[1]").textContent()) ?? "").split("–");
    const label = ((await heading.locator("xpath=following-sibling::p[2]").textContent()) ?? "").trim();
    return { first: (names[0] ?? "").trim(), label, second: (names[1] ?? "").trim() };
  };

  // Sechs Spiele bis zum Final: 2 Gewinnerrunde 1, 1 Verliererrunde 1,
  // Gewinnerrunde-Final, Verliererrunde-Final, Final. Der Gewinner ist der
  // zuerst genannte Teilnehmer — im Final der zweite (Verliererrunde).
  const labels: string[] = [];
  for (let played = 0; played < 5; played += 1) {
    await page.goto(tournamentUrl);
    const match = await nextUp();
    labels.push(match.label);
    expect(match.label).not.toBe("Final");
    await page.getByRole("button", { name: `Auf ${boardName} starten` }).click();
    await page.goto(`/matches?organisation=${organizationId}`);
    await page.getByRole("link").filter({ hasText: "läuft" }).first().click();
    await expect(page.getByRole("region", { name: "Match-Scoreboard" })).toBeVisible();
    await playOut(match.first);
  }
  // Das letzte Spiel ist das Final.
  await page.goto(tournamentUrl);
  const grandFinal = await nextUp();
  expect(grandFinal.label).toBe("Final");
  expect(labels.filter((label) => label.startsWith("Gewinnerrunde"))).toHaveLength(3);
  expect(labels.filter((label) => label.startsWith("Verliererrunde"))).toHaveLength(2);
  await page.getByRole("button", { name: `Auf ${boardName} starten` }).click();
  await page.goto(`/matches?organisation=${organizationId}`);
  await page.getByRole("link").filter({ hasText: "läuft" }).first().click();
  await expect(page.getByRole("region", { name: "Match-Scoreboard" })).toBeVisible();
  await playOut(grandFinal.second);

  await page.goto(tournamentUrl);
  await expect(page.getByText("Final-Rückspiel").first()).toBeVisible();

  async function playOut(winnerName: string): Promise<void> {
    await decideLegStart(page, winnerName);
    // Beide Einstellungen gelten je Browserkontext: nur beim ersten Match umstellen.
    if (!switched) {
      await switchInputMode(page, "Runde");
      await setScoreboardSwitch(page, "Checkout-Darts bestätigen", false);
      switched = true;
    }
    for (const points of [180, 0, 180, 0]) {
      await typeRoundScore(page, points);
      await expect(page.getByRole("button", { name: "Ziffer 0" })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Aufnahme erfassen" })).toBeDisabled();
    }
    await typeRoundScore(page, 141);
    const dialog = page.getByRole("dialog", { name: "Checkout erfassen" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Checkout-Feld").selectOption("12");
    await dialog.getByRole("button", { name: "Checkout speichern" }).click();
    await expect(page.getByText("Match beendet")).toBeVisible();
  }
});
