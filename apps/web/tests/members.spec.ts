import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";
import { signUpWithOrganization } from "./sign-up";

/**
 * Die Mitgliederverwaltung hatte keine Oberflaeche: `PATCH
 * .../members/:userId` liess sich nur bedienen, wenn die Ziel-`userId` schon
 * bekannt war, und eine Liste gab es gar nicht.
 *
 * Der Rollenwechsel und die Deaktivierung einer ZWEITEN Person brauchen ein
 * zweites Konto; sie sind in `memberships.integration.spec.ts` abgedeckt.
 * Hier laeuft, was ein Konto durch die echte Oberflaeche zeigen kann: die
 * Liste, die Regel fuer die eigene Zeile und der Rueckzug einer Einladung.
 */
const registrationSeeds: RegistrationInvitationSeed[] = [];

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

test("the members page lists the own membership and withdraws an open invitation", async ({ page }) => {
  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-mitglieder-${suffix}@example.test`;
  const ownerName = `E2E Mitglieder Leitung ${short}`;
  const invitedEmail = `e2e-eingeladen-${suffix}@example.test`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);

  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken,
    email,
    organizationName: `E2E Mitglieder Club ${short}`,
    organizationSlug: `e2e-mitglieder-club-${suffix}`,
    ownerName,
  });

  // Eingeladen wird auf der Spielerseite; die Verwaltung zeigt die Einladung
  // danach als offen und nimmt sie zurueck.
  await page.goto(`/spieler?organisation=${organizationId}`);
  await page.getByLabel("E-Mail-Adresse für Einladung").fill(invitedEmail);
  await page.getByRole("button", { name: "Einladen" }).click();
  await expect(page.getByLabel("Einladungscode")).toBeVisible();

  await page.goto(`/mitglieder?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Mitglieder" })).toBeVisible();

  // Die eigene Zeile traegt die Rolle, aber kein Bedienelement.
  const ownRow = page.getByRole("listitem").filter({ hasText: email });
  await expect(ownRow).toContainText("Inhaber");
  await expect(ownRow).toContainText("Die eigene Mitgliedschaft ändert eine andere Person.");
  await expect(ownRow.getByRole("combobox")).toHaveCount(0);

  const invitationRow = page.getByRole("listitem").filter({ hasText: invitedEmail });
  await expect(invitationRow).toBeVisible();
  await invitationRow.getByRole("button", { name: "Einladung zurückziehen" }).click();

  await expect(page.getByText(invitedEmail)).toHaveCount(0);
  await expect(page.getByText("Keine offene Einladung.")).toBeVisible();
});
