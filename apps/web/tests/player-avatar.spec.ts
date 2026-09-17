import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Locator } from "@playwright/test";

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
 *
 * Zwei Fallen, die eine frühere Fassung nicht vermieden hat:
 *
 * 1. `PlayerAvatarControl` rendert die lokale Vorschau als `<img>` im selben
 *    `<header>`, und der Knopf „Bild speichern" existiert nur, solange eine
 *    Vorschau da ist. Ein blosses „`<img>` im Kopf ist sichtbar" ist also
 *    schon VOR dem Klick erfüllt und bliebe es auch, wenn der `PUT`
 *    scheiterte. Der Fall wartet deshalb auf den Knopf „Bild entfernen" —
 *    der erscheint erst, wenn die Vorschau weg UND `avatarChecksum` über
 *    die nachgeladene `["player-avatar", ...]`-Abfrage gesetzt ist.
 * 2. Ein `page.goto` auf die Spielerliste wäre ein vollständiger
 *    Seitenneuaufbau: der verwirft den Query-Cache und holt ohnehin alles
 *    frisch vom Server — die Invalidierung von `["players", ...]` würde nie
 *    geprüft. Der Fall navigiert deshalb per Klick (Übersicht → Spieler),
 *    derselbe `QueryClient` bleibt dabei im Speicher.
 *
 * Beide Bild-Zusicherungen prüfen zusätzlich `naturalWidth`: ein `<img>` mit
 * fester Höhe/Breite gilt auch dann als sichtbar, wenn die Quelle mit 403
 * oder 422 scheiterte (kaputtes Bild-Icon hat trotzdem eine Layout-Box).
 * Dass die vorherige Fassung das (nicht mehr bestehende) CSP-Problem aus
 * Task 6 überhaupt fing, verdankt sich der `cspViolations`-Wache aus
 * `fixtures.ts`, nicht dieser Zusicherung — die Wache bleibt also so wichtig
 * wie die Bildprüfung selbst.
 */
async function expectRealImage(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
}

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

  // Beweist den Upload UND das Nachladen von ["player-avatar", ...]: der
  // Knopf existiert nur ohne Vorschau UND mit gesetzter Prüfsumme.
  await expect(page.getByRole("button", { name: "Bild entfernen" })).toBeVisible();
  const profileHeader = page.locator("header").filter({ hasText: playerName });
  await expectRealImage(profileHeader.locator("img"));

  // Client-seitige Navigation statt `page.goto`: derselbe Query-Cache bleibt
  // im Speicher, die Spielerliste liest ihn frisch nur, wenn
  // ["players", ...] tatsächlich invalidiert wurde.
  await page.getByRole("link", { name: "Übersicht" }).click();
  await page.getByRole("link", { name: /Kader pflegen/u }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Spieler & Team" })).toBeVisible();

  const playerRow = page.locator("div").filter({ hasText: playerName }).filter({
    has: page.getByRole("link", { name: "Profil" }),
  });
  await expectRealImage(playerRow.locator("img").first());
});
