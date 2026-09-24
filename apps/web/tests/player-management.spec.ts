import { randomUUID } from "node:crypto";

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";
import { signUpWithOrganization } from "./sign-up";

/**
 * Deckt die Spielerverwaltung end-to-end ab (Task 4, PR 1 "Bearbeiten,
 * archivieren, loeschen"): Bearbeiten aller Felder, Archivieren/
 * Reaktivieren, endgueltige Loeschung ohne Historie, und der 409
 * `PLAYER_HAS_HISTORY`-Fall mit "Stattdessen archivieren" fuer einen
 * Spieler, der bereits in einem Team steht.
 *
 * `player-list.render.spec.tsx` prueft dieselben Uebergaenge schon isoliert
 * mit gemocktem `apiRequest` -- diese Datei belegt zusaetzlich, dass sie
 * gegen die echte API und ueber eine echte Navigation (Spielerliste ->
 * Teams -> Spielerliste) tatsaechlich funktionieren.
 */

const registrationSeeds: RegistrationInvitationSeed[] = [];

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

/**
 * Die einzige Kombination aus Klassen, die nur die aeusserste Huelle einer
 * Spielerzeile in `player-list.tsx` traegt (`PlayerRow`s
 * `min-h-16 rounded-xl border border-slate-800 ...`). Ein blosses
 * `div`-Filter auf Text und den Profil-Link (wie in `player-avatar.spec.ts`)
 * traeffe hier auch die umschliessenden Listen-Container, sobald mehr als
 * ein Spieler auf der Seite steht -- hier stehen ab dem zweiten Spieler
 * immer zwei.
 */
function playerRow(page: Page, playerName: string): Locator {
  return page.locator("div.min-h-16.border-slate-800").filter({ hasText: playerName });
}

async function createPlayer(page: Page, organizationId: string, playerName: string): Promise<void> {
  await page.goto(`/spieler?organisation=${organizationId}`);
  const playerForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Spieler hinzufügen" }),
  });
  await playerForm.getByLabel("Anzeigename", { exact: true }).fill(playerName);
  await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
  await expect(playerRow(page, playerName)).toBeVisible();
}

test("Spieler bearbeiten, archivieren, reaktivieren und endgueltig loeschen", async ({ page }) => {
  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-spielerverwaltung-${suffix}@example.test`;
  const ownerName = `E2E Verwaltung Leitung ${short}`;
  const playerName = `E2E Loeschbar ${short}`;
  const secondPlayerName = `E2E Kaderperson ${short}`;
  const teamName = `E2E Team ${short}`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);

  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken,
    email,
    organizationName: `E2E Verwaltung Club ${short}`,
    organizationSlug: `e2e-verwaltung-club-${suffix}`,
    ownerName,
  });

  // 1. Anlegen, bearbeiten (Spitzname und E-Mail), Speichern.
  await createPlayer(page, organizationId, playerName);
  const row = playerRow(page, playerName);

  // Der Status ("Aktiv"/"Archiviert") steht als Textfragment neben Spitzname,
  // Team und Konto in EINER `<p class="text-caption">` ohne eigene
  // Umhuellung -- `getByText(..., { exact: true })` verlangt den gesamten
  // Text des kleinsten umschliessenden Elements und schluege deshalb fehl.
  // `toContainText`, gescopet auf genau dieses `<p>`, prueft das
  // Textfragment ohne diese Falle und ohne Kollision mit Knopftexten wie
  // "Archivieren"/"Reaktivieren" (siehe `player-list.tsx`).
  const status = row.locator("p.text-caption");

  await row.getByRole("button", { name: "Bearbeiten" }).click();
  const editDialog = page.getByRole("dialog", { name: "Spieler bearbeiten" });
  await expect(editDialog).toBeVisible();
  await editDialog.getByLabel("Spitzname", { exact: true }).fill("Löschbär");
  await editDialog.getByLabel("E-Mail", { exact: true }).fill("loeschbar@example.test");
  await editDialog.getByRole("button", { name: "Speichern" }).click();
  await expect(editDialog).toBeHidden();
  await expect(status).toContainText("Löschbär");

  // 2. Archivieren (mit Bestaetigung), Status pruefen, Reaktivieren.
  await row.getByRole("button", { name: "Archivieren" }).click();
  const archiveDialog = page.getByRole("dialog", { name: "Spieler archivieren" });
  await expect(archiveDialog).toBeVisible();
  await archiveDialog.getByRole("button", { name: "Archivieren" }).click();
  await expect(archiveDialog).toBeHidden();
  await expect(status).toContainText("Archiviert");

  await row.getByRole("button", { name: "Reaktivieren" }).click();
  await expect(status).toContainText("Aktiv");

  // 3. Endgueltig loeschen: der Spieler hat keine Historie, verschwindet
  // also direkt aus der Liste.
  await row.getByRole("button", { name: "Löschen" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Spieler endgültig löschen" });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Endgültig löschen" }).click();
  await expect(deleteDialog).toBeHidden();
  await expect(playerRow(page, playerName)).toHaveCount(0);

  // 4. Zweiter Spieler, in ein Team aufgenommen: die endgueltige Loeschung
  // scheitert an der Historie und bietet stattdessen die Archivierung an.
  await createPlayer(page, organizationId, secondPlayerName);

  await page.goto(`/teams?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Teams" })).toBeVisible();
  const teamForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Team anlegen" }),
  });
  await teamForm.getByLabel("Name", { exact: true }).fill(teamName);
  await teamForm.getByRole("button", { name: "Team anlegen" }).click();
  const teamCard = page.locator("article").filter({ hasText: teamName });
  await expect(teamCard).toBeVisible();
  await teamCard.getByLabel("Person aufnehmen").selectOption({ label: secondPlayerName });
  await teamCard.getByRole("button", { name: "Aufnehmen" }).click();
  await expect(teamCard.getByText(secondPlayerName, { exact: true })).toBeVisible();

  await page.goto(`/spieler?organisation=${organizationId}`);
  const secondRow = playerRow(page, secondPlayerName);
  await expect(secondRow).toBeVisible();

  await secondRow.getByRole("button", { name: "Löschen" }).click();
  const secondDeleteDialog = page.getByRole("dialog", { name: "Spieler endgültig löschen" });
  await expect(secondDeleteDialog).toBeVisible();
  await secondDeleteDialog.getByRole("button", { name: "Endgültig löschen" }).click();

  const historyError = secondDeleteDialog.getByRole("alert");
  await expect(historyError).toContainText("lässt sich nur archivieren");

  await secondDeleteDialog.getByRole("button", { name: "Stattdessen archivieren" }).click();
  await expect(secondDeleteDialog).toBeHidden();
  await expect(secondRow.locator("p.text-caption")).toContainText("Archiviert");
});
