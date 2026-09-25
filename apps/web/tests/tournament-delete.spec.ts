import { expect, test } from "./fixtures";
import { randomUUID } from "node:crypto";

import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";
import { signUpWithOrganization } from "./sign-up";

/**
 * Spec 2026-09-25-lease-karenz-turnier-loeschen (Befund 7): Ein versehentlich
 * angelegtes Turnier laesst sich aus der Kommandozentrale loeschen, solange
 * nichts gespielt wurde. Der Sperrfall (laufendes Match, Ergebnis) ist im
 * Integrationstest der API und im Render-Test des Panels abgedeckt.
 */
const registrationSeeds: RegistrationInvitationSeed[] = [];

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

test("die Turnierleitung loescht ein ungespieltes Turnier aus der Kommandozentrale", async ({ page }) => {
  test.slow();

  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-loeschen-${suffix}@example.test`;
  const boardName = `E2E Loeschen Board ${short}`;
  const tournamentName = `E2E Versehen Cup ${short}`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);

  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken,
    email,
    organizationName: `E2E Loeschen Club ${short}`,
    organizationSlug: `e2e-loeschen-club-${suffix}`,
    ownerName: `E2E Loeschen Leitung ${short}`,
  });

  await page.goto(`/spieler?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Spieler & Team" })).toBeVisible();
  for (const name of ["Eins", "Zwei", "Drei", "Vier"].map((index) => `E2E Loeschen ${index} ${short}`)) {
    await page.getByLabel("Anzeigename", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }

  await page.goto(`/matches?organisation=${organizationId}`);
  await page.getByLabel("Neues Board").fill(boardName);
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await expect(page.locator("li").filter({ hasText: boardName }).filter({ hasText: "frei" })).toBeVisible();

  await page.goto(`/turniere/neu?organisation=${organizationId}`);
  await page.getByLabel("Format").selectOption("ROUND_ROBIN");
  await page.getByLabel("Name").fill(tournamentName);
  await page.getByLabel("Best of Legs").selectOption("1");
  await Promise.all([
    page.waitForURL(/\/turniere\/[^/?]+\?organisation=/u),
    page.getByRole("button", { name: "Turnier starten" }).click(),
  ]);
  await expect(page.getByRole("button", { name: `Auf ${boardName} starten` })).toBeVisible();

  // Nichts gespielt: der Abschnitt bietet das Loeschen an.
  const deleteButton = page.getByRole("button", { name: "Turnier löschen" });
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  const dialog = page.getByRole("dialog", { name: "Turnier löschen" });
  await expect(dialog).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/turniere\?organisation=/u),
    dialog.getByRole("button", { name: "Turnier löschen" }).click(),
  ]);
  await expect(page.getByRole("heading", { level: 1, name: "Turniere" })).toBeVisible();
  await expect(page.getByText(tournamentName)).toHaveCount(0);
});
