import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";

const registrationSeeds: RegistrationInvitationSeed[] = [];

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

test("the sign-in page shows its brand logos", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("img", { name: "Dart Ost" })).toBeVisible();
  const footer = page.locator("footer");
  await expect(footer).toContainText("powered by");
  await expect(footer.getByRole("img", { name: "Sutter Precision" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Turnierleitung" })).toHaveCount(0);
});

test("the tournament administration uses the entry page dark surface", async ({ page }) => {
  await page.goto("/turniere");

  const tournamentSurface = page.locator("main.sektorenring");
  await expect(tournamentSurface).toBeVisible();
  await expect(tournamentSurface).toHaveCSS("background-color", "rgb(2, 6, 23)");
  await expect(tournamentSurface).toHaveCSS("color-scheme", "dark");
});

test("a viewer does not receive tournament administration access", async ({ page }) => {
  const suffix = randomUUID();
  const email = `e2e-viewer-${suffix}@example.test`;
  registrationSeeds.push(await createRegistrationInvitation(email, "VIEWER"));

  await page.goto("/");
  await page.getByRole("button", { name: "Eingeladen? Konto erstellen" }).click();
  await page.getByLabel("Name").fill("E2E Viewer");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("E2ePassword123!");
  await page.getByRole("button", { name: "Konto erstellen" }).click();

  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole("button", { name: "Annehmen" }).click();
  await expect(
    page.getByRole("heading", { name: "E2E Invitation Organization" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Turnierleitung" })).toHaveCount(0);
});

test("a club can complete a match and start a generated tournament match", async ({
  page,
}) => {
  const suffix = randomUUID();
  const email = `e2e-${suffix}@example.test`;
  const organizationName = `E2E Club ${suffix.slice(0, 8)}`;
  const organizationSlug = `e2e-club-${suffix}`;

  registrationSeeds.push(await createRegistrationInvitation(email));

  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "DartBase - Turnier Plattform" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Eingeladen? Konto erstellen" }).click();
  await page.getByLabel("Name").fill("E2E Owner");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("E2ePassword123!");
  await page.getByRole("button", { name: "Konto erstellen" }).click();

  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Offene Einladungen" })).toBeVisible();
  await page.getByRole("button", { name: "Annehmen" }).click();
  await expect(page.getByRole("link", { name: "Turnierleitung" })).toBeVisible();
  await page.getByPlaceholder("Vereinsname").fill(organizationName);
  await page.getByPlaceholder("club-slug").fill(organizationSlug);
  await page.getByRole("button", { name: "Erstellen", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: organizationName }),
  ).toBeVisible();
  await page.getByPlaceholder("Anzeigename").fill("E2E Player One");
  await page.getByPlaceholder("Spitzname (optional)").fill("The Test One");
  await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
  await expect(page.getByText("E2E Player One", { exact: true }).first()).toBeVisible();
  await page.getByPlaceholder("Anzeigename").fill("E2E Player Two");
  await page.getByPlaceholder("Spitzname (optional)").fill("The Test Two");
  await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
  await expect(page.getByText("E2E Player Two", { exact: true }).first()).toBeVisible();

  await page.getByLabel("Boardname").fill("E2E Board");
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await expect(page.getByText(/E2E Board: frei/u)).toBeVisible();
  await page.getByLabel("Erster Spieler").selectOption({ label: "E2E Player One" });
  await page.getByLabel("Zweiter Spieler").selectOption({ label: "E2E Player Two" });
  await page.getByLabel("Startspieler").selectOption({ label: "E2E Player One beginnt" });
  await page.getByLabel("Best of Legs").selectOption("1");
  await page.getByLabel("Board", { exact: true }).selectOption({ label: "E2E Board" });
  await page.getByRole("button", { name: "Match starten" }).click();
  await expect(page.getByRole("region", { name: "Match-Scoreboard" })).toBeVisible();
  await expect(page.getByText("Dieses Gerät steuert das Board · Verbindung aktiv")).toBeVisible();
  await expect(page.getByLabel("Aufnahmescore")).toBeEnabled();

  const record = async (score: number, expectedRest: number, checkoutDouble?: number) => {
    await page.getByLabel("Aufnahmescore").fill(String(score));
    if (checkoutDouble !== undefined) {
      await page.getByLabel("Checkout-Double").fill(String(checkoutDouble));
      await page.getByLabel("Doppelversuche").fill("1");
    }
    await page.getByRole("button", { name: "Erfassen" }).click();
    await expect(page.getByLabel(`E2E Player One, Restscore`)).toHaveText(String(expectedRest));
  };

  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.getByLabel("Aufnahmescore").fill("180");
  await page.getByRole("button", { name: "Erfassen" }).click();
  await expect(page.getByText(/Aufnahme wartet dauerhaft gespeichert/u)).toBeVisible();
  await page.context().setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(page.getByLabel("E2E Player One, Restscore")).toHaveText("321");
  await page.getByRole("button", { name: "Letzte Aufnahme zurücknehmen" }).click();
  await expect(page.getByLabel("E2E Player One, Restscore")).toHaveText("501");
  await record(180, 321);
  await page.getByLabel("Aufnahmescore").fill("60");
  await page.getByRole("button", { name: "Erfassen" }).click();
  await expect(page.getByLabel("E2E Player Two, Restscore")).toHaveText("441");
  await record(180, 141);
  await page.getByLabel("Aufnahmescore").fill("60");
  await page.getByRole("button", { name: "Erfassen" }).click();
  await expect(page.getByLabel("E2E Player Two, Restscore")).toHaveText("381");
  await record(141, 0, 12);
  await expect(page.getByText("Match beendet")).toBeVisible();
  await expect(page.getByText("E2E Player One gewinnt")).toBeVisible();

  for (const name of ["E2E Player Three", "E2E Player Four"]) {
    await page.getByPlaceholder("Anzeigename").fill(name);
    await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }

  await page.getByRole("link", { name: "Turnierleitung" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Turniere" })).toBeVisible();
  await page.getByRole("link", { name: "Turnier anlegen", exact: true }).click();
  await page.getByLabel("Format").selectOption("ROUND_ROBIN");
  await expect(page.getByText("Matches insgesamt").locator("..")).toContainText("6");
  await page.getByLabel("Name").fill("E2E Vereinscup");
  await page.getByLabel("Best of Legs").selectOption("1");
  await Promise.all([
    page.waitForURL(/\/turniere\/[^/?]+\?organisation=/u),
    page.getByRole("button", { name: "Turnier starten" }).click(),
  ]);

  await expect(page.getByRole("heading", { level: 1, name: "E2E Vereinscup" })).toBeVisible();
  await page.getByRole("button", { name: "Auf E2E Board starten" }).click();
  await expect(page.getByRole("heading", { level: 3, name: "E2E Board" })).toBeVisible();
  await expect(page.getByText("501").first()).toBeVisible();
  const tournamentUrl = page.url();

  await page.goto("/");
  await expect(page.getByRole("region", { name: "Match-Scoreboard" })).toBeVisible();
  const scoreTournamentVisit = async (score: number, checkoutDouble?: number) => {
    const visitScore = page.getByLabel("Aufnahmescore");
    await visitScore.fill(String(score));
    if (checkoutDouble !== undefined) {
      await page.getByLabel("Checkout-Double").fill(String(checkoutDouble));
      await page.getByLabel("Doppelversuche").fill("1");
    }
    await page.getByRole("button", { name: "Erfassen" }).click();
    if (checkoutDouble === undefined) {
      await expect(visitScore).toHaveValue("");
    } else {
      await expect(page.getByText("Match beendet")).toBeVisible();
    }
  };
  await scoreTournamentVisit(180);
  await scoreTournamentVisit(0);
  await scoreTournamentVisit(180);
  await scoreTournamentVisit(0);
  await scoreTournamentVisit(141, 12);

  await page.goto(tournamentUrl);
  await expect(page.getByRole("heading", { level: 1, name: "E2E Vereinscup" })).toBeVisible();
  await page.getByRole("button", { name: "Ergebnis korrigieren" }).click();
  await page.getByLabel("Korrekturgrund").fill("Entscheidender Visit falsch erfasst");
  await page.getByRole("button", { name: "Match wieder öffnen" }).click();
  await expect(page.getByText("Noch kein Ergebnis erfasst.")).toBeVisible();
  await expect(page.getByText("141").first()).toBeVisible();
});
