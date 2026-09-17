import { randomUUID } from "node:crypto";
import path from "node:path";

import { expect, test } from "./fixtures";
import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";
import { signUpWithOrganization } from "./sign-up";

const avatarFixturePath = path.join(__dirname, "fixtures", "avatar.png");

/**
 * Hochladen ersetzt die Initialen durch das Bild, und zwar an BEIDEN
 * Stellen, die eine Prüfsumme zeigen: dem Profilkopf und der Spielerliste.
 * Jede Fläche liest ihre eigene Abfrage (`["player-avatar", ...]` bzw.
 * `["players", ...]`) — dieser Fall belegt, dass Task 7 beide nach dem
 * Hochladen tatsächlich invalidiert, nicht nur eine davon.
 */
const registrationSeeds: RegistrationInvitationSeed[] = [];

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

test("ein Profilbild laesst sich hochladen und erscheint im Profil und in der Spielerliste", async ({ page }) => {
  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-profilbild-${suffix}@example.test`;
  const ownerName = `E2E Profilbild Leitung ${short}`;
  const playerName = `E2E Profilbild Spieler ${short}`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);

  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken,
    email,
    organizationName: `E2E Profilbild Club ${short}`,
    organizationSlug: `e2e-profilbild-club-${suffix}`,
    ownerName,
  });

  await page.goto(`/spieler?organisation=${organizationId}`);
  const playerForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Spieler hinzufügen" }),
  });
  await playerForm.getByLabel("Anzeigename", { exact: true }).fill(playerName);
  await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
  await expect(page.getByText(playerName, { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Profil" }).click();
  await expect(page.getByRole("heading", { level: 1, name: playerName })).toBeVisible();

  await page.getByLabel("Bild auswählen").setInputFiles(avatarFixturePath);
  await page.getByRole("button", { name: "Bild speichern" }).click();

  const profileHeader = page.locator("header").filter({ hasText: playerName });
  await expect(profileHeader.locator("img")).toBeVisible();

  await page.goto(`/spieler?organisation=${organizationId}`);
  const playerRow = page.locator("div").filter({ hasText: playerName }).filter({
    has: page.getByRole("link", { name: "Profil" }),
  });
  await expect(playerRow.locator("img").first()).toBeVisible();
});
