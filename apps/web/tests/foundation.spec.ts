import { expect, test, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";

const registrationSeeds: RegistrationInvitationSeed[] = [];

async function visibleLabeledControl(container: Locator, label: string): Promise<Locator> {
  const visibleLabel = container.getByText(label, { exact: true });
  await expect(visibleLabel).toBeVisible();
  const control = container.getByLabel(label, { exact: true });
  await expect(control).toBeVisible();
  const controlId = await control.getAttribute("id");
  if (controlId === null) throw new Error(`Expected the ${label} control to have an id.`);
  expect(
    await visibleLabel.evaluate(
      (element, id) => element instanceof HTMLLabelElement && element.control?.id === id,
      controlId,
    ),
    `${label} visible label association`,
  ).toBe(true);
  return control;
}

function relativeLuminance([red, green, blue]: readonly number[]): number {
  const [linearRed, linearGreen, linearBlue] = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linearRed + 0.7152 * linearGreen + 0.0722 * linearBlue;
}

function contrastRatio(foreground: readonly number[], background: readonly number[]): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

test("the sign-in page shows its brand logos", async ({ page }) => {
  await page.goto("/");

  const dartOstLink = page.getByRole("link", {
    name: "Website von Dart Ost öffnen (öffnet in neuem Tab)",
  });
  await expect(dartOstLink.getByRole("img", { name: "Dart Ost" })).toBeVisible();
  await expect(dartOstLink).toHaveAttribute("href", "https://dartost.ch/");
  await expect(dartOstLink).toHaveAttribute("target", "_blank");
  await expect(dartOstLink).toHaveAttribute("rel", "noopener noreferrer");
  const footer = page.locator("footer");
  await expect(footer).toContainText("powered by");
  await expect(footer.getByRole("img", { name: "Sutter Precision" })).toBeVisible();
  const sutterPrecisionLink = footer.getByRole("link", {
    name: "Website von Sutter Precision öffnen (öffnet in neuem Tab)",
  });
  await expect(sutterPrecisionLink).toHaveAttribute(
    "href",
    "https://www.sutter-precision.ch/",
  );
  await expect(sutterPrecisionLink).toHaveAttribute("target", "_blank");
  await expect(sutterPrecisionLink).toHaveAttribute("rel", "noopener noreferrer");
  const footerSecondaryText = footer.getByText("powered by", { exact: true });
  const computedColors = await footerSecondaryText.evaluate((element) => {
    const footerElement = element.closest("footer");
    if (footerElement === null) throw new Error("Expected secondary text inside a footer.");
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("Expected a canvas 2D context for contrast testing.");
    const toRgba = (color: string): readonly number[] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    return {
      background: toRgba(getComputedStyle(footerElement).backgroundColor),
      foreground: toRgba(getComputedStyle(element).color),
    };
  });
  expect(computedColors.background[3], "public sign-in footer owns an opaque background").toBe(255);
  expect(
    contrastRatio(computedColors.foreground.slice(0, 3), computedColors.background.slice(0, 3)),
    "public sign-in footer secondary text contrast",
  ).toBeGreaterThanOrEqual(4.5);
  await expect(page.getByRole("link", { name: "Turnierleitung" })).toHaveCount(0);
});

test("the sign-in form exposes credentials to password managers", async ({ page }) => {
  await page.goto("/");

  const email = page.getByLabel("E-Mail");
  await expect(email).toHaveAttribute("name", "email");
  await expect(email).toHaveAttribute("type", "email");
  await expect(email).toHaveAttribute("autocomplete", "username");

  const password = page.getByLabel("Passwort");
  await expect(password).toHaveAttribute("name", "password");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveAttribute("autocomplete", "current-password");

  await page.getByRole("button", { name: "Eingeladen? Konto erstellen" }).click();
  await expect(page.getByLabel("E-Mail")).toHaveAttribute("autocomplete", "username");
  await expect(page.getByLabel("Passwort")).toHaveAttribute("autocomplete", "new-password");
});

test("the public sign-in page links to the branded standalone manual", async ({ page }) => {
  await page.goto("/");

  const manualLink = page.getByRole("link", { name: "Bedienungsanleitung" });
  await expect(manualLink).toHaveAttribute("href", "/bedienungsanleitung.html");
  await expect(page.locator("footer")).toBeVisible();
  await expect(page.locator("main a").last()).toHaveText("Bedienungsanleitung");
  await manualLink.click();

  await expect(page).toHaveURL(/\/bedienungsanleitung\.html$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Bedienungsanleitung" }),
  ).toBeVisible();
  const dartBaseMark = page.locator(".brand-logo");
  await expect(dartBaseMark).toHaveAttribute("src", "/dartbase-manual-icon.png");
  await expect
    .poll(() =>
      dartBaseMark.evaluate(
        (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  const manualHeading = page.getByRole("heading", { level: 1, name: "Bedienungsanleitung" });
  await expect
    .poll(() =>
      manualHeading.evaluate((heading) => {
        const range = document.createRange();
        range.selectNodeContents(heading);
        return range.getClientRects().length;
      }),
    )
    .toBe(1);
  await expect(page.getByRole("navigation", { name: "Inhaltsverzeichnis" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Zurück zu DartBase" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(page.getByRole("link", { name: "Dart Ost", exact: true })).toHaveAttribute(
    "href",
    "https://dartost.ch/",
  );
});

test("the tournament administration uses the entry page dark surface", async ({ page }) => {
  await page.goto("/turniere");

  const tournamentSurface = page.locator("main.sektorenring");
  await expect(tournamentSurface).toBeVisible();
  await expect(tournamentSurface).toHaveCSS("background-color", "rgb(2, 6, 23)");
  await expect(tournamentSurface).toHaveCSS("color-scheme", "dark");
});

test("a viewer does not receive tournament administration access", async ({ page }) => {
  const suffix = randomUUID();
  const email = `e2e-viewer-${suffix}@example.test`;
  const invitation = await createRegistrationInvitation(email, "VIEWER");
  registrationSeeds.push(invitation);

  await page.goto("/");
  await page.getByRole("button", { name: "Eingeladen? Konto erstellen" }).click();
  await page.getByLabel("Name").fill("E2E Viewer");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("E2ePassword123!");
  await page.getByLabel("Einladungscode").fill(invitation.claimToken);
  await page.getByRole("button", { name: "Konto erstellen" }).click();

  await expect(page.getByText(email)).toBeVisible();
  await page.getByLabel("Einladungscode").fill(invitation.claimToken);
  await page.getByRole("button", { name: "Annehmen" }).click();
  await expect(
    page.getByRole("heading", { name: "E2E Invitation Organization" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Turnierleitung" })).toHaveCount(0);
});

test("a club can complete a match and start a generated tournament match", async ({
  page,
}) => {
  test.slow();

  const suffix = randomUUID();
  const email = `e2e-${suffix}@example.test`;
  const organizationName = `E2E Club ${suffix.slice(0, 8)}`;
  const organizationSlug = `e2e-club-${suffix}`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);

  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "DartBase - Turnier Plattform" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Eingeladen? Konto erstellen" }).click();
  await page.getByLabel("Name").fill("E2E Owner");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("E2ePassword123!");
  await page.getByLabel("Einladungscode").fill(invitation.claimToken);
  await page.getByRole("button", { name: "Konto erstellen" }).click();

  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Offene Einladungen" })).toBeVisible();
  await page.getByLabel("Einladungscode").fill(invitation.claimToken);
  await page.getByRole("button", { name: "Annehmen" }).click();
  await expect(page.getByRole("link", { name: "Turnierleitung" })).toBeVisible();
  const organizationForm = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Organisation erstellen" }),
  });
  await (await visibleLabeledControl(organizationForm, "Organisationsname")).fill(organizationName);
  await (await visibleLabeledControl(organizationForm, "Organisationskürzel")).fill(organizationSlug);
  await page.getByRole("button", { name: "Erstellen", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: organizationName }),
  ).toBeVisible();

  await page.getByRole("link", { name: /Kader pflegen/u }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Spieler & Team" }),
  ).toBeVisible();
  const spielerUrl = page.url();
  const playerForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Spieler hinzufügen" }),
  });
  const invitationForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Einladen" }),
  });
  await visibleLabeledControl(invitationForm, "E-Mail-Adresse für Einladung");
  await visibleLabeledControl(invitationForm, "Rolle");
  await (await visibleLabeledControl(playerForm, "Anzeigename")).fill("E2E Player One");
  await (await visibleLabeledControl(playerForm, "Spitzname (optional)")).fill("The Test One");
  await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
  await expect(page.getByText("E2E Player One", { exact: true }).first()).toBeVisible();
  await playerForm.getByLabel("Anzeigename", { exact: true }).fill("E2E Player Two");
  await playerForm.getByLabel("Spitzname (optional)", { exact: true }).fill("The Test Two");
  await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
  await expect(page.getByText("E2E Player Two", { exact: true }).first()).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: /Boards anlegen/u }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
  const matchesUrl = page.url();

  await page.getByLabel("Neues Board").fill("E2E Board");
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await expect(page.locator("li").filter({ hasText: "E2E Board" }).filter({ hasText: "frei" })).toBeVisible();
  await page.getByLabel("Spieler 1").selectOption({ label: "E2E Player One" });
  await page.getByLabel("Spieler 2").selectOption({ label: "E2E Player Two" });
  await page.getByLabel("Wer beginnt?").selectOption({ label: "E2E Player One" });
  await page.getByLabel("Legs (Best of)").selectOption("1");
  await page.getByLabel("Board (optional)").selectOption({ label: "E2E Board" });
  await page.getByRole("button", { name: "Match starten" }).click();
  await expect(page.getByRole("region", { name: "Match-Scoreboard" })).toBeVisible();
  await expect(page.getByText("Dieses Gerät steuert das Board · Verbindung aktiv")).toBeVisible();
  await expect(page.getByLabel("Aufnahmescore")).toBeEnabled();
  await expect(page.getByLabel("Geworfene Darts")).toHaveCount(0);
  await expect(page.getByLabel("Checkout-Double")).toHaveCount(0);
  await expect(page.getByLabel("Doppelversuche")).toHaveCount(0);

  await page.getByLabel("Aufnahmescore").fill("100");
  await page.getByRole("button", { name: "Erfassen" }).click();
  await expect(page.getByLabel("E2E Player One, Restscore")).toHaveText("401");
  await page.getByRole("button", { name: "Match abbrechen" }).click();
  const abortDialog = page.getByRole("dialog", { name: "Match abbrechen" });
  await expect(abortDialog).toContainText("0 lokal gespeicherte Aufnahmen werden verworfen");
  await abortDialog.getByLabel("Abbruchgrund").fill("Board versehentlich falsch zugewiesen");
  await abortDialog.getByRole("button", { name: "Match endgültig abbrechen" }).click();
  await expect(abortDialog).toHaveCount(0);
  await page.goto(matchesUrl);
  await expect(page.getByRole("region", { name: "Match-Scoreboard" })).toHaveCount(0);
  await expect(page.locator("li").filter({ hasText: "E2E Board" }).filter({ hasText: "frei" })).toBeVisible();
  await page.getByLabel("Legs (Best of)").selectOption("1");
  await page.getByLabel("Board (optional)").selectOption({ label: "E2E Board" });
  await page.getByRole("button", { name: "Match starten" }).click();
  await expect(page.getByRole("region", { name: "Match-Scoreboard" })).toBeVisible();
  await expect(page.getByLabel("E2E Player One, Restscore")).toHaveText("501");

  const record = async (
    score: number,
    expectedRest: number,
    checkout?: { readonly field: number; readonly darts: 1 | 2 | 3 },
  ) => {
    await page.getByLabel("Aufnahmescore").fill(String(score));
    await page.getByRole("button", { name: "Erfassen" }).click();
    if (checkout !== undefined) {
      const dialog = page.getByRole("dialog", { name: "Checkout erfassen" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Checkout-Feld").selectOption(String(checkout.field));
      await dialog.getByLabel("Benötigte Darts").selectOption(String(checkout.darts));
      await dialog.getByRole("button", { name: "Checkout speichern" }).click();
    }
    await expect(page.getByLabel(`E2E Player One, Restscore`)).toHaveText(String(expectedRest));
  };

  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.getByLabel("Aufnahmescore").fill("180");
  await page.getByRole("button", { name: "Erfassen" }).click();
  await expect(page.getByText(/Aufnahme wartet dauerhaft gespeichert/u)).toBeVisible();
  await page.context().setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(page.getByLabel("E2E Player One, Restscore")).toHaveText("321");
  await page.getByRole("button", { name: "Letzte Aufnahme zurücknehmen" }).click();
  await expect(page.getByLabel("E2E Player One, Restscore")).toHaveText("501");
  await record(180, 321);
  await expect(page.getByText("E2E Player One · 3 Darts").first()).toBeVisible();
  await page.getByLabel("Aufnahmescore").fill("60");
  await page.getByRole("button", { name: "Erfassen" }).click();
  await expect(page.getByLabel("E2E Player Two, Restscore")).toHaveText("441");
  await record(180, 141);
  await page.getByLabel("Aufnahmescore").fill("60");
  await page.getByRole("button", { name: "Erfassen" }).click();
  await expect(page.getByLabel("E2E Player Two, Restscore")).toHaveText("381");
  await record(91, 50);
  await page.getByLabel("Aufnahmescore").fill("60");
  await page.getByRole("button", { name: "Erfassen" }).click();
  await expect(page.getByLabel("E2E Player Two, Restscore")).toHaveText("321");
  await page.getByLabel("Aufnahmescore").fill("50");
  await page.getByRole("button", { name: "Erfassen" }).click();
  const checkoutDialog = page.getByRole("dialog", { name: "Checkout erfassen" });
  await expect(checkoutDialog).toBeVisible();
  await checkoutDialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(checkoutDialog).toHaveCount(0);
  await expect(page.getByLabel("E2E Player One, Restscore")).toHaveText("50");
  await page.getByRole("button", { name: "Erfassen" }).click();
  await checkoutDialog.getByLabel("Checkout-Feld").selectOption("25");
  await checkoutDialog.getByLabel("Benötigte Darts").selectOption("1");
  await checkoutDialog.getByRole("button", { name: "Checkout speichern" }).click();
  await expect(page.getByLabel("E2E Player One, Restscore")).toHaveText("0");
  await expect(page.getByText("Match beendet")).toBeVisible();
  await expect(page.getByText("E2E Player One gewinnt")).toBeVisible();

  await page.goto(spielerUrl);
  for (const name of ["E2E Player Three", "E2E Player Four"]) {
    await page.getByLabel("Anzeigename", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }

  await page.goto("/");
  await page.getByRole("link", { name: "Turnierleitung" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Turniere" })).toBeVisible();
  await page.getByRole("link", { name: "Turnier anlegen", exact: true }).click();
  await page.getByLabel("Format").selectOption("ROUND_ROBIN");
  await expect(page.getByText("Matches insgesamt").locator("..")).toContainText("6");
  await page.getByLabel("Name").fill("E2E Vereinscup");
  await page.getByLabel("Best of Legs").selectOption("1");
  await Promise.all([
    page.waitForURL(/\/turniere\/[^/?]+\?organisation=/u),
    page.getByRole("button", { name: "Turnier starten" }).click(),
  ]);

  await expect(page.getByRole("heading", { level: 1, name: "E2E Vereinscup" })).toBeVisible();
  await page.getByRole("button", { name: "Auf E2E Board starten" }).click();
  await expect(page.getByRole("heading", { level: 3, name: "E2E Board" })).toBeVisible();
  await expect(page.getByText("501").first()).toBeVisible();
  const tournamentUrl = page.url();

  await page.goto(matchesUrl);
  await page.getByRole("link").filter({ hasText: "läuft" }).first().click();
  await expect(page.getByRole("region", { name: "Match-Scoreboard" })).toBeVisible();
  const scoreTournamentVisit = async (score: number, checkoutDouble?: number) => {
    const visitScore = page.getByLabel("Aufnahmescore");
    await visitScore.fill(String(score));
    await page.getByRole("button", { name: "Erfassen" }).click();
    if (checkoutDouble === undefined) {
      await expect(visitScore).toHaveValue("");
    } else {
      const dialog = page.getByRole("dialog", { name: "Checkout erfassen" });
      await dialog.getByLabel("Checkout-Feld").selectOption(String(checkoutDouble));
      await dialog.getByLabel("Benötigte Darts").selectOption("3");
      await dialog.getByRole("button", { name: "Checkout speichern" }).click();
      await expect(page.getByText("Match beendet")).toBeVisible();
    }
  };
  await scoreTournamentVisit(180);
  await scoreTournamentVisit(0);
  await scoreTournamentVisit(180);
  await scoreTournamentVisit(0);
  await scoreTournamentVisit(141, 12);

  await page.goto(tournamentUrl);
  await expect(page.getByRole("heading", { level: 1, name: "E2E Vereinscup" })).toBeVisible();
  await page.getByRole("button", { name: "Ergebnis korrigieren" }).click();
  await page.getByLabel("Korrekturgrund").fill("Entscheidender Visit falsch erfasst");
  await page.getByRole("button", { name: "Match wieder öffnen" }).click();
  await expect(page.getByText("Noch kein Ergebnis erfasst.")).toBeVisible();
  await expect(page.getByText("141").first()).toBeVisible();

  await page.getByRole("button", { name: "Spielerausfall erfassen" }).click();
  const withdrawalDialog = page.getByRole("dialog", { name: "Spielerausfall erfassen" });
  await withdrawalDialog.getByLabel("Spieler").selectOption({ label: "E2E Player One" });
  await withdrawalDialog.getByLabel("Ausfallgrund").fill("Akute Verletzung");
  await withdrawalDialog.getByRole("button", { name: "Ausfall bestätigen" }).click();
  await expect(page.getByText("E2E Player One · Ausgefallen")).toBeVisible();
  await expect(page.getByText(/gewinnt kampflos/u).first()).toBeVisible();

  const tournamentId = new URL(tournamentUrl).pathname.split("/").at(-1);
  if (tournamentId === undefined) throw new Error("Expected tournament ID in dashboard URL.");
  await page.goto(`/live/${tournamentId}`);
  await expect(page.getByText("E2E Player One · Ausgefallen")).toBeVisible();
});
