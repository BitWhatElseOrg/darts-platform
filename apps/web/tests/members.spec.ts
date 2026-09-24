import { expect, test } from "./fixtures";
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

  // Die eigene Zeile traegt die Rolle, aber kein Bedienelement, das Rechte
  // veraendert. Die Zuordnung eines Spielerprofils ist davon ausgenommen: sie
  // gewaehrt keine Berechtigung (ADR 0015), und wer die Organisation
  // einrichtet, verknuepft zuerst das eigene Profil.
  const ownRow = page.getByRole("listitem").filter({ hasText: email });
  await expect(ownRow).toContainText("Inhaber");
  await expect(ownRow).toContainText("Die eigene Mitgliedschaft ändert eine andere Person.");
  await expect(ownRow.getByRole("combobox", { name: "Rolle" })).toHaveCount(0);
  await expect(ownRow.getByRole("combobox", { name: "Spielerprofil" })).toHaveCount(1);
  await expect(ownRow).toContainText("Kein Spielerprofil zugeordnet");

  const invitationRow = page.getByRole("listitem").filter({ hasText: invitedEmail });
  await expect(invitationRow).toBeVisible();
  await invitationRow.getByRole("button", { name: "Einladung zurückziehen" }).click();

  await expect(page.getByText(invitedEmail)).toHaveCount(0);
  await expect(page.getByText("Keine offene Einladung.")).toBeVisible();
});

test("der Inhaber entfernt ein Mitglied, das die Einladung angenommen hat", async ({ page, browser }) => {
  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-entfernen-owner-${suffix}@example.test`;
  const guestEmail = `e2e-entfernen-gast-${suffix}@example.test`;
  const ownerName = `E2E Entfernen Leitung ${short}`;
  const organizationName = `E2E Entfernen Club ${short}`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);

  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken,
    email,
    organizationName,
    organizationSlug: `e2e-entfernen-club-${suffix}`,
    ownerName,
  });

  // Einladen ueber die Spielerseite; der Link ist der Fallback, den auch
  // `email-flows.spec.ts` fuer die Annahme verwendet.
  await page.goto(`/spieler?organisation=${organizationId}`);
  await page.getByLabel("E-Mail-Adresse für Einladung").fill(guestEmail);
  await page.getByRole("button", { name: "Einladen" }).click();
  const invitationLink = await page.getByLabel("Einladungslink").inputValue();

  // Zweiter Kontext: das Mitglied nimmt die Einladung mit einem eigenen
  // Konto an.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await guest.goto(invitationLink);
    await expect(guest.getByRole("heading", { name: `Einladung zu ${organizationName}` })).toBeVisible();
    await guest.getByLabel("Name").fill(`E2E Entfernen Gast ${short}`);
    await guest.getByLabel("Passwort").fill("E2eGastPasswort123!");
    await guest.getByRole("button", { name: "Konto erstellen und Einladung annehmen" }).click();
    await expect(guest).toHaveURL(/\/$/u);
    await expect(guest.getByText(guestEmail)).toBeVisible();
    await expect(guest.getByText(organizationName).first()).toBeVisible();
  } finally {
    await guestContext.close();
  }

  await page.goto(`/mitglieder?organisation=${organizationId}`);
  const guestRow = page.getByRole("listitem").filter({ hasText: guestEmail });
  await expect(guestRow).toBeVisible();
  await guestRow.getByRole("button", { name: "Entfernen" }).click();

  const confirmDialog = page.getByRole("dialog", { name: "Mitglied entfernen" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText("verliert den Zugang zu dieser Organisation");
  await confirmDialog.getByRole("button", { name: "Entfernen" }).click();

  await expect(page.getByRole("listitem").filter({ hasText: guestEmail })).toHaveCount(0);

  // Dieselbe Adresse laesst sich erneut einladen — das Konto besteht weiter,
  // nur die Mitgliedschaft ist geloescht.
  await page.goto(`/spieler?organisation=${organizationId}`);
  await page.getByLabel("E-Mail-Adresse für Einladung").fill(guestEmail);
  await page.getByRole("button", { name: "Einladen" }).click();
  await expect(page.getByLabel("Einladungscode")).toBeVisible();
});
