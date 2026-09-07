import { expect, test } from "./fixtures";
import { randomUUID } from "node:crypto";

import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";
import { signUpWithOrganization } from "./sign-up";

/**
 * Die Offline-Warteschlange der Kommandozentrale (`command-centre.tsx`) war
 * bis hierher ohne Browser-Test — abgedeckt war nur die Warteschlange der
 * Scoringflaeche (`foundation.spec.ts`). Beide teilen sich die
 * IndexedDB-Ablage und die Wiedergabe, aber die Zentrale entscheidet eigene
 * Dinge: Sie darf ein Board nicht doppelt vergeben, sie meldet den
 * Verbindungsabbruch ueber ihre Live-Region, und sie uebertraegt selbsttaetig,
 * sobald das Geraet zurueck im Netz ist (`useOnlineFlush`).
 *
 * Vier Spieler, weil ein Turnier nicht weniger zulaesst; gebraucht wird nur
 * die erste spielbereite Paarung.
 */
const registrationSeeds: RegistrationInvitationSeed[] = [];

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

test("the command centre queues a board assignment while offline and sends it on reconnect", async ({ page }) => {
  test.slow();

  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-zentrale-${suffix}@example.test`;
  const boardName = `E2E Zentrale Board ${short}`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);

  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken,
    email,
    organizationName: `E2E Zentrale Club ${short}`,
    organizationSlug: `e2e-zentrale-club-${suffix}`,
    ownerName: `E2E Zentrale Leitung ${short}`,
  });

  await page.goto(`/spieler?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Spieler & Team" })).toBeVisible();
  for (const name of ["Eins", "Zwei", "Drei", "Vier"].map((index) => `E2E Zentrale ${index} ${short}`)) {
    await page.getByLabel("Anzeigename", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }

  await page.goto(`/matches?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
  await page.getByLabel("Neues Board").fill(boardName);
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await expect(
    page.locator("li").filter({ hasText: boardName }).filter({ hasText: "frei" }),
  ).toBeVisible();

  await page.goto(`/turniere/neu?organisation=${organizationId}`);
  await page.getByLabel("Format").selectOption("ROUND_ROBIN");
  await page.getByLabel("Name").fill(`E2E Zentrale Cup ${short}`);
  await page.getByLabel("Best of Legs").selectOption("1");
  await Promise.all([
    page.waitForURL(/\/turniere\/[^/?]+\?organisation=/u),
    page.getByRole("button", { name: "Turnier starten" }).click(),
  ]);
  const start = page.getByRole("button", { name: `Auf ${boardName} starten` });
  await expect(start).toBeVisible();

  // Ohne Verbindung: die Zuweisung geht in die Warteschlange, statt verloren
  // zu gehen, und die Fläche sagt es.
  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await start.click();

  await expect(page.getByText("1 Befehl in der Warteschlange")).toBeVisible();
  await expect(page.getByText(new RegExp(`Zuweisung auf ${boardName}`, "u")).first()).toBeVisible();

  // Zurück im Netz überträgt die Zentrale von selbst — ohne Zutun.
  await page.context().setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);

  await expect(page.getByText("1 Befehl in der Warteschlange")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: boardName })).toBeVisible();
});
