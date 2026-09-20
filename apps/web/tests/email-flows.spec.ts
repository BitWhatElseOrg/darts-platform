import { randomUUID } from "node:crypto";

import { expect, test } from "./fixtures";
import { backdateInvitationUpdatedAt } from "./invitation-clock";
import { readLatestPasswordResetToken } from "./password-reset-token";
import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";
import { signUpWithOrganization } from "./sign-up";

/**
 * Der Mail-Weg ohne Mail: Einladungslink aus dem Fallback-Feld, Reset-Token
 * aus der Datenbank. Damit laufen die Faelle mit EMAIL_PROVIDER=log und
 * unabhaengig davon, ob ein Worker die Versandzeilen bereits geleert hat.
 */
const seeds: RegistrationInvitationSeed[] = [];

test.afterEach(async () => {
  await Promise.all(seeds.splice(0).map((seed) => seed.cleanup()));
});

test("eine eingeladene Person registriert sich ueber den (erneut gesendeten) Link", async ({ page, browser }) => {
  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const ownerEmail = `e2e-mail-owner-${suffix}@example.test`;
  const guestEmail = `e2e-mail-guest-${suffix}@example.test`;
  const organizationName = `E2E Mail Club ${short}`;

  const seed = await createRegistrationInvitation(ownerEmail);
  seeds.push(seed);
  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: seed.claimToken,
    email: ownerEmail,
    organizationName,
    organizationSlug: `e2e-mail-club-${suffix}`,
    ownerName: `E2E Mail Owner ${short}`,
  });

  // Einladen: Link und Code erscheinen einmalig als Fallback.
  await page.goto(`/spieler?organisation=${organizationId}`);
  await page.getByLabel("E-Mail-Adresse für Einladung").fill(guestEmail);
  await page.getByRole("button", { name: "Einladen" }).click();
  const firstLink = await page.getByLabel("Einladungslink").inputValue();
  expect(firstLink).toContain(`/einladung/`);
  expect(firstLink).toContain("#code=");

  // Mitgliederliste: Zustellstatus sichtbar, erneut senden rotiert den Code.
  await page.goto(`/mitglieder?organisation=${organizationId}`);
  const row = page.getByRole("listitem").filter({ hasText: guestEmail });
  await expect(row).toContainText(/Mail: (ausstehend|versendet)/u);

  // Direkt nach dem Einladen greift die 60-Sekunden-Sperre. Der Routen-Ansager
  // von Next.js traegt ebenfalls `role="alert"`, deshalb die Textfilterung.
  await row.getByRole("button", { name: "Erneut senden" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "gerade erst erneut gesendet" }),
  ).toBeVisible();

  // Einladung kuenstlich altern lassen, statt eine Minute zu warten.
  await backdateInvitationUpdatedAt(guestEmail, 61);
  await row.getByRole("button", { name: "Erneut senden" }).click();
  const secondLink = await row.getByLabel("Neuer Einladungslink").inputValue();
  expect(secondLink).not.toBe(firstLink);

  // Gastkontext: der alte Link ist ungueltig, der neue fuehrt zur Vorschau.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await guest.goto(firstLink);
    // Der Routen-Ansager von Next.js traegt ebenfalls `role="alert"`; die
    // Meldung wird deshalb ueber ihren Text herausgegriffen.
    await expect(guest.getByRole("alert").filter({ hasText: "ungültig oder abgelaufen" })).toBeVisible();

    await guest.goto(secondLink);
    await expect(guest.getByRole("heading", { name: `Einladung zu ${organizationName}` })).toBeVisible();
    await expect(guest.getByLabel("E-Mail")).toHaveValue(guestEmail);
    await guest.getByLabel("Name").fill(`E2E Gast ${short}`);
    await guest.getByLabel("Passwort").fill("E2eGastPasswort123!");
    await guest.getByRole("button", { name: "Konto erstellen und Einladung annehmen" }).click();

    await expect(guest).toHaveURL(/\/$/u);
    await expect(guest.getByText(guestEmail)).toBeVisible();
    await expect(guest.getByText(organizationName).first()).toBeVisible();
  } finally {
    await guestContext.close();
  }

  // Die Einladung ist angenommen und verschwindet aus der offenen Liste. Der
  // leere Zustand wird zuerst zugesichert: `toHaveCount(0)` allein waere schon
  // erfuellt, solange die Einladungen ueberhaupt noch geladen werden.
  await page.reload();
  await expect(page.getByText("Keine offene Einladung.")).toBeVisible();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: guestEmail })
      .getByRole("button", { name: "Erneut senden" }),
  ).toHaveCount(0);
});

test("ein Konto setzt sein Passwort ueber den Reset-Link neu", async ({ page }) => {
  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-reset-${suffix}@example.test`;

  const seed = await createRegistrationInvitation(email);
  seeds.push(seed);
  await signUpWithOrganization(page, {
    claimToken: seed.claimToken,
    email,
    organizationName: `E2E Reset Club ${short}`,
    organizationSlug: `e2e-reset-club-${suffix}`,
    ownerName: `E2E Reset ${short}`,
  });
  await page.getByRole("button", { name: "Abmelden" }).click();

  await page.goto("/");
  await page.getByRole("link", { name: "Passwort vergessen?" }).click();
  await expect(page).toHaveURL(/\/passwort\/vergessen$/u);
  await page.getByLabel("E-Mail").fill(email);
  await page.getByRole("button", { name: "Link anfordern" }).click();
  await expect(page.getByRole("status")).toContainText("ist eine E-Mail mit einem Link unterwegs");

  const token = await readLatestPasswordResetToken(email);
  await page.goto(`/passwort/neu?token=${encodeURIComponent(token)}`);
  await page.getByLabel("Neues Passwort").fill("E2eNeuesPasswort456!");
  await page.getByLabel("Passwort wiederholen").fill("E2eNeuesPasswort456!");
  await page.getByRole("button", { name: "Passwort setzen" }).click();
  await expect(page.getByRole("status")).toContainText("Dein Passwort ist gesetzt");

  await page.getByRole("link", { name: "Zur Anmeldung" }).click();
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("E2eNeuesPasswort456!");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText(email)).toBeVisible();

  // Ohne Token fuehrt die Seite zurueck zur Anforderung. Der Routen-Ansager
  // von Next.js traegt ebenfalls `role="alert"`, deshalb die Textfilterung.
  await page.goto("/passwort/neu");
  await expect(page.getByRole("alert").filter({ hasText: "ungültig oder abgelaufen" })).toBeVisible();
});
