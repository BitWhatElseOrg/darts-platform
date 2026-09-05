import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";
import { switchInputMode } from "./scoreboard-entry";
import { signUpWithOrganization } from "./sign-up";

/**
 * Browser-Test der Vollbild-Scoringfläche selbst (Task 15): Kopfzeile,
 * Wurf-für-Wurf-Eingabe samt Bestätigungsfläche und der Moduswechsel im
 * Einstellungs-Modal. Der vollständige Matchablauf (Bust, Checkout, Undo,
 * Offline-Warteschlange, Turnierintegration) bleibt Sache von
 * `foundation.spec.ts` und `team-encounter.spec.ts` — die laufen seit
 * diesem Task über den Runden-Modus, weil ihr eigentlicher Prüfgegenstand
 * der Matchablauf ist, nicht das Keypad.
 */

const registrationSeeds: RegistrationInvitationSeed[] = [];

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

test("the fullscreen scoreboard records a dart-by-dart visit and switches input mode", async ({
  page,
}) => {
  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-scoreboard-${suffix}@example.test`;
  const playerOneName = `E2E Scoring Eins ${short}`;
  const playerTwoName = `E2E Scoring Zwei ${short}`;
  const boardName = `E2E Scoreboard ${short}`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);

  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken,
    email,
    organizationName: `E2E Scoreboard Club ${short}`,
    organizationSlug: `e2e-scoreboard-club-${suffix}`,
    ownerName: "E2E Scoreboard Ligaleitung",
  });

  // Zwei Spieler und ein Board, wie in team-encounter.spec.ts aufgebaut.
  await page.goto(`/spieler?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Spieler & Team" })).toBeVisible();
  for (const name of [playerOneName, playerTwoName]) {
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

  // Als Rolle mit Scoring-Recht (Organisationsinhaberin) ein Match mit
  // zugewiesenem Board öffnen.
  await page.getByLabel("Spieler 1").selectOption({ label: playerOneName });
  await page.getByLabel("Spieler 2").selectOption({ label: playerTwoName });
  await page.getByLabel("Wer beginnt?").selectOption({ label: playerOneName });
  await page.getByLabel("Legs (Best of)").selectOption("1");
  await page.getByLabel("Board (optional)").selectOption({ label: boardName });
  await page.getByRole("button", { name: "Match starten" }).click();
  await expect(page.getByRole("region", { name: "Match-Scoreboard" })).toBeVisible();

  // Kopfzeile zeigt Leg und laufende Runde.
  await expect(page.getByText("LEG 1", { exact: true })).toBeVisible();
  await expect(page.getByText("RUNDE 1", { exact: true })).toBeVisible();

  // Wurf-für-Wurf ist die Standardeingabe: Triple 20, Triple 20, Single 20.
  await page.getByRole("button", { name: "Umschalter TRIPLE" }).click();
  await page.getByRole("button", { name: "Triple 20" }).click();
  await page.getByRole("button", { name: "Umschalter TRIPLE" }).click();
  await page.getByRole("button", { name: "Triple 20" }).click();
  await page.getByRole("button", { name: "Single 20" }).click();

  // Nach dem dritten Wurf erscheint die Bestätigungsfläche (Standard:
  // „Punktzahl bestätigen" ist an).
  await expect(page.getByRole("button", { name: "WEITER" })).toBeVisible();
  await expect(page.getByText("GEWORFEN")).toBeVisible();
  await expect(page.getByText("140", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "WEITER" }).click();

  // 501 - (60 + 60 + 20) = 361.
  await expect(page.getByLabel(`${playerOneName}, Restscore`)).toHaveText("361");

  // Zahnrad öffnen, auf Runde umschalten, SPIEL FORTSETZEN, Ziffernfeld
  // erscheint.
  await switchInputMode(page, "Runde");
  await expect(page.getByRole("button", { name: "Ziffer 1" })).toBeVisible();
});
