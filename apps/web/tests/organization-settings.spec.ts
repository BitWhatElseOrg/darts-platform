import { expect, test } from "./fixtures";
import { randomUUID } from "node:crypto";

import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";
import { signUpWithOrganization } from "./sign-up";

/**
 * Die Organisationsseite hatte keine Oberflaeche: `PATCH .../organizations/:id`
 * liess sich nicht bedienen, und endgueltig loeschen (Spec
 * 2026-09-24-bearbeiten-loeschen, Task 8) ging ueberhaupt nicht.
 *
 * Geloescht wird ausschliesslich eine hier frisch angelegte Organisation,
 * niemals eine geteilte Testorganisation. Die Inhaberschaft behaelt nach dem
 * Loeschen weiterhin Zugang zur Organisation aus der Einladung
 * (`createRegistrationInvitation`) — daran zeigt sich, dass die Auswahl auf
 * eine andere zugaengliche Organisation zurueckfaellt, statt ins Leere zu
 * laufen.
 */
const registrationSeeds: RegistrationInvitationSeed[] = [];

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

test("die Inhaberschaft benennt die Organisation um und loescht sie danach endgueltig", async ({ page }) => {
  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-organisation-${suffix}@example.test`;
  const ownerName = `E2E Organisation Leitung ${short}`;
  const organizationName = `E2E Organisation Club ${short}`;
  const renamedOrganizationName = `${organizationName} Neu`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);

  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken,
    email,
    organizationName,
    organizationSlug: `e2e-organisation-club-${suffix}`,
    ownerName,
  });

  await page.goto(`/?organisation=${organizationId}`);
  await page.getByRole("link", { name: "Organisation" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Organisation" })).toBeVisible();

  const nameInput = page.getByLabel("Name");
  await expect(nameInput).toHaveValue(organizationName);
  await nameInput.fill(renamedOrganizationName);
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status")).toHaveText("Gespeichert.");

  // Der neue Name gilt sofort auch auf der Uebersicht — dieselbe Abfrage
  // (`["organizations"]`), die `WorkspaceShell` und das Dashboard fuellt.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 2, name: renamedOrganizationName })).toBeVisible();

  await page.goto(`/organisation?organisation=${organizationId}`);
  await page.getByRole("button", { name: "Organisation löschen" }).click();

  const confirmDialog = page.getByRole("dialog", { name: "Organisation löschen" });
  await expect(confirmDialog).toBeVisible();
  const confirmButton = confirmDialog.getByRole("button", { name: "Organisation löschen" });
  await expect(confirmButton).toBeDisabled();

  const confirmInput = confirmDialog.getByLabel(
    `Zur Bestätigung den Namen „${renamedOrganizationName}" eintippen`,
  );
  await confirmInput.fill("Falscher Name");
  await expect(confirmButton).toBeDisabled();

  await confirmInput.fill(renamedOrganizationName);
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  await expect(page).toHaveURL(/\/$/u);
  // Die geloeschte Organisation kommt in keiner Auswahl mehr vor; die
  // Inhaberschaft landet auf der Organisation aus der Einladung, mit der sie
  // sich registriert hat.
  await expect(page.getByText(renamedOrganizationName)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "E2E Invitation Organization" })).toBeVisible();
});
