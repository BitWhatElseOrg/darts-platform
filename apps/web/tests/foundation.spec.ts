import type { Locator } from "@playwright/test";

import { expect, test } from "./fixtures";
import { randomUUID } from "node:crypto";

import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";
import {
  openAbortDialog, selectCheckoutDarts, setScoreboardSwitch, switchInputMode, typeRoundScore,
} from "./scoreboard-entry";
import { signUpWithOrganization } from "./sign-up";

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
  // Task 11: die Statuszeile bleibt als Live-Region immer im DOM (Befund 5
  // der Review-Runde), zeigt aber ohne Vorkommnis (fremde Steuerung, offline,
  // wartende Aufnahmen, Fehler) weder Text noch Höhe — die frühere
  // "Verbindung aktiv"-Dauermeldung entfällt deshalb.
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(page.getByRole("status")).toBeEmpty();
  // Task 15: das frühere Freitext-Formular „Aufnahmescore" samt optionalen
  // Zusatzfeldern für Geworfene Darts, Checkout-Double und Doppelversuche
  // gibt es nicht mehr — der Moduswechsel (Task 8/9) hat es vollständig
  // durch die zwei Keypads ersetzt, ein Umschalten auf ein Freitextfeld
  // existiert in keinem der beiden Modi. Dart ist die neue Standardeingabe;
  // ihr Keypad steht bereit, sobald die Fläche lädt. Die drei Wächter
  // bleiben bestehen: die alten Bezeichner tauchen in der Fläche nirgends
  // mehr auf.
  await expect(page.getByRole("button", { name: "Single 20" })).toBeEnabled();
  await expect(page.getByLabel("Geworfene Darts")).toHaveCount(0);
  await expect(page.getByLabel("Checkout-Double")).toHaveCount(0);
  await expect(page.getByLabel("Doppelversuche")).toHaveCount(0);

  // Task 11 Spec: die Vollbildfläche füllt 100dvh und scrollt nicht. Geprüft
  // auf einem Mobilviewport in Hoch- und Querformat, danach zurück auf die
  // Projekt-Standardauflösung für den Rest dieses Tests.
  const overflowsViewport = () => page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight + 1,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await overflowsViewport(), "Hochformat überläuft 100dvh").toBe(false);
  await page.setViewportSize({ width: 844, height: 390 });
  expect(await overflowsViewport(), "Querformat überläuft 100dvh").toBe(false);
  await page.setViewportSize({ width: 1280, height: 720 });

  // Der Rundenmodus bleibt für den Rest des Tests der bequemere Weg,
  // beliebige Aufnahmesummen zu erfassen; der Wurf-für-Wurf-Modus samt dem
  // Moduswechsel selbst ist eigens in scoreboard.spec.ts abgedeckt.
  await switchInputMode(page, "Runde");
  await typeRoundScore(page, 100);
  await expect(page.getByLabel("E2E Player One, Restscore")).toHaveText("401");
  // Task 15: Seit Task 14 gibt es keinen direkten "Match abbrechen"-Knopf
  // mehr auf der Fläche — der Weg führt über das Einstellungs-Modal
  // ("SPIEL BEENDEN"), das beim Abbruch-Dialog absichtlich offen bleibt.
  await openAbortDialog(page);
  const abortDialog = page.getByRole("dialog", { name: "Match abbrechen" });
  await expect(abortDialog).toContainText("0 lokal gespeicherte Aufnahmen werden verworfen");
  await abortDialog.getByLabel("Abbruchgrund").fill("Board versehentlich falsch zugewiesen");
  await abortDialog.getByRole("button", { name: "Match endgültig abbrechen" }).click();
  await expect(abortDialog).toHaveCount(0);
  // Task 14: beide Dialoge schliessen erst gemeinsam bei erfolgreichem
  // Abbruch (match-scoreboard.tsx, `lastAbortSuccess`).
  await expect(page.getByRole("dialog", { name: "Einstellungen" })).toHaveCount(0);
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
    await typeRoundScore(page, score);
    if (checkout !== undefined) {
      const dialog = page.getByRole("dialog", { name: "Checkout erfassen" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Checkout-Feld").selectOption(String(checkout.field));
      await selectCheckoutDarts(dialog, checkout.darts);
      await dialog.getByRole("button", { name: "Checkout speichern" }).click();
    }
    await expect(page.getByLabel(`E2E Player One, Restscore`)).toHaveText(String(expectedRest));
  };

  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await typeRoundScore(page, 180);
  await expect(page.getByText(/Aufnahme wartet dauerhaft gespeichert/u)).toBeVisible();
  await page.context().setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(page.getByLabel("E2E Player One, Restscore")).toHaveText("321");
  await page.getByRole("button", { name: "Letzte Aufnahme zurücknehmen" }).click();
  await expect(page.getByLabel("E2E Player One, Restscore")).toHaveText("501");
  await record(180, 321);
  // Seit Task 14 steht "Letzte Aufnahmen" im Einstellungs-Modal, nicht mehr
  // direkt auf der Fläche — derselbe Beleg (drei Darts je Aufnahme kommen
  // im Zustand an) über den neuen Weg.
  await page.getByRole("button", { name: "Einstellungen" }).click();
  const recentVisitsDialog = page.getByRole("dialog", { name: "Einstellungen" });
  await expect(recentVisitsDialog).toBeVisible();
  await expect(recentVisitsDialog.getByText("E2E Player One · 3 Darts").first()).toBeVisible();
  await recentVisitsDialog.getByRole("button", { name: "Spiel fortsetzen" }).click();
  await expect(recentVisitsDialog).toHaveCount(0);
  await typeRoundScore(page, 60);
  await expect(page.getByLabel("E2E Player Two, Restscore")).toHaveText("441");
  await record(180, 141);
  await typeRoundScore(page, 60);
  await expect(page.getByLabel("E2E Player Two, Restscore")).toHaveText("381");
  await record(91, 50);
  await typeRoundScore(page, 60);
  await expect(page.getByLabel("E2E Player Two, Restscore")).toHaveText("321");
  await typeRoundScore(page, 50);
  const checkoutDialog = page.getByRole("dialog", { name: "Checkout erfassen" });
  await expect(checkoutDialog).toBeVisible();
  await checkoutDialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(checkoutDialog).toHaveCount(0);
  await expect(page.getByLabel("E2E Player One, Restscore")).toHaveText("50");
  // Der Wert bleibt im Ziffernfeld stehen (nur `resetSubmit`, kein
  // Zurücksetzen des Eingabewerts) — deshalb genügt ein erneuter Klick auf
  // „Aufnahme erfassen" ohne die 50 neu zu tippen, um den Checkout-Schritt
  // ein zweites Mal auszulösen.
  await page.getByRole("button", { name: "Aufnahme erfassen" }).click();
  await checkoutDialog.getByLabel("Checkout-Feld").selectOption("25");
  await selectCheckoutDarts(checkoutDialog, 1);
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
    await typeRoundScore(page, score);
    if (checkoutDouble === undefined) {
      // Nach erfolgreicher Übernahme setzt die Fläche das Ziffernfeld
      // zurück; `roundValue` wird ausschliesslich bei tatsächlichem Erfolg
      // geleert (match-scoreboard.tsx, `submitJustSucceeded`) — ein
      // Versionskonflikt liesse den Wert bewusst stehen. "Rücktaste"
      // aktiviert erst, wenn das Absenden vorbei ist; erst danach zeigt
      // "Aufnahme erfassen" gesperrt den geleerten, also erfolgreich
      // übernommenen Wert.
      await expect(page.getByRole("button", { name: "Rücktaste" })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Aufnahme erfassen" })).toBeDisabled();
    } else {
      const dialog = page.getByRole("dialog", { name: "Checkout erfassen" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("Benötigte Darts")).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "3 Darts" })).toHaveCount(0);
      await dialog.getByLabel("Checkout-Feld").selectOption(String(checkoutDouble));
      await dialog.getByRole("button", { name: "Checkout speichern" }).click();
      await expect(page.getByText("Match beendet")).toBeVisible();
    }
  };
  await scoreTournamentVisit(180);
  await scoreTournamentVisit(0);
  await scoreTournamentVisit(180);
  await scoreTournamentVisit(0);
  // „Checkout-Darts bestätigen" AUS: der Checkout-Schritt fragt nur noch nach
  // dem getroffenen Feld und sendet drei Darts — dasselbe Ergebnis wie die
  // ausdrückliche Wahl „3 Darts" darüber, aber ohne die zusätzliche Frage.
  // Die Einstellung war bis zur Abschlussrunde folgenlos gespeichert.
  await setScoreboardSwitch(page, "Checkout-Darts bestätigen", false);
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

  // Turniere sind standardmässig privat (Task 6) — die öffentliche
  // Live-Ansicht bleibt erst nach ausdrücklicher Freigabe erreichbar.
  await page.getByRole("switch", { name: "Öffentliche Freigabe: NEIN" }).click();
  await expect(page.getByRole("switch", { name: "Öffentliche Freigabe: JA" })).toBeVisible();

  const tournamentId = new URL(tournamentUrl).pathname.split("/").at(-1);
  if (tournamentId === undefined) throw new Error("Expected tournament ID in dashboard URL.");
  // Die interne ID bleibt ein gültiger, umleitender Adressweg (Übergangsweg
  // Task 6, Step 3): sie trifft auf `[publicId]` und wird auf die
  // öffentliche Adresse umgeleitet.
  await page.goto(`/live/${tournamentId}`);
  // Die Teilnehmerliste steht in der Live-Ansicht zugeklappt am Seitenende.
  await page.locator("summary", { hasText: "Teilnehmende" }).click();
  await expect(page.getByText("E2E Player One · Ausgefallen")).toBeVisible();
});

test("gibt ein Turnier fuer die oeffentliche Live-Ansicht frei", async ({ browser, page }) => {
  test.slow();

  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-freigabe-${suffix}@example.test`;
  const tournamentName = `E2E Freigabecup ${short}`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);

  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken,
    email,
    organizationName: `E2E Freigabe Club ${short}`,
    organizationSlug: `e2e-freigabe-club-${suffix}`,
    ownerName: `E2E Freigabe Leitung ${short}`,
  });

  await page.goto(`/spieler?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Spieler & Team" })).toBeVisible();
  for (const name of ["Eins", "Zwei", "Drei", "Vier"].map((index) => `E2E Freigabe ${index} ${short}`)) {
    await page.getByLabel("Anzeigename", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }

  const boardName = `E2E Freigabe Board ${short}`;
  await page.goto(`/matches?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
  await page.getByLabel("Neues Board").fill(boardName);
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await expect(
    page.locator("li").filter({ hasText: boardName }).filter({ hasText: "frei" }),
  ).toBeVisible();

  await page.goto(`/turniere/neu?organisation=${organizationId}`);
  await page.getByLabel("Format").selectOption("ROUND_ROBIN");
  await page.getByLabel("Name").fill(tournamentName);
  await page.getByLabel("Best of Legs").selectOption("1");
  await Promise.all([
    page.waitForURL(/\/turniere\/[^/?]+\?organisation=/u),
    page.getByRole("button", { name: "Turnier starten" }).click(),
  ]);
  await expect(page.getByRole("heading", { level: 1, name: tournamentName })).toBeVisible();

  // Ohne Freigabe: die interne ID ist keine gültige öffentliche Adresse, und
  // ein Turnier ist standardmässig privat — die anonyme Live-Ansicht kennt es
  // nicht.
  const tournamentId = new URL(page.url()).pathname.split("/").at(-1);
  if (tournamentId === undefined) throw new Error("Expected tournament ID in dashboard URL.");
  const anonymousBeforeSharing = await browser.newContext();
  try {
    const anonymousPage = await anonymousBeforeSharing.newPage();
    await anonymousPage.goto(`/live/${tournamentId}`);
    await expect(anonymousPage.getByText("Turnier nicht gefunden.")).toBeVisible();
  } finally {
    await anonymousBeforeSharing.close();
  }

  // Freigeben und die öffentliche Adresse aus dem Freigabe-Bereich lesen.
  await page.getByRole("switch", { name: "Öffentliche Freigabe: NEIN" }).click();
  await expect(page.getByRole("switch", { name: "Öffentliche Freigabe: JA" })).toBeVisible();
  const shareLink = page.getByRole("region", { name: "Öffentliche Freigabe" }).getByRole("link");
  await expect(shareLink).toBeVisible();
  const shareHref = await shareLink.getAttribute("href");
  if (shareHref === null) throw new Error("Expected a public share link in the share panel.");

  // Dasselbe Turnier öffentlich, in einem zweiten anonymen Kontext.
  const anonymousAfterSharing = await browser.newContext();
  try {
    const publicPage = await anonymousAfterSharing.newPage();
    await publicPage.goto(shareHref);
    await expect(publicPage.getByRole("heading", { level: 1, name: tournamentName })).toBeVisible();
  } finally {
    await anonymousAfterSharing.close();
  }
});

test("stellt einen Anzeige-Schluessel aus und oeffnet damit die Board-Ansicht eines privaten Turniers", async ({ browser, page }) => {
  test.slow();

  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-schluessel-${suffix}@example.test`;
  const tournamentName = `E2E Schluesselcup ${short}`;
  const keyLabel = `E2E Eingang ${short}`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);

  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken,
    email,
    organizationName: `E2E Schluessel Club ${short}`,
    organizationSlug: `e2e-schluessel-club-${suffix}`,
    ownerName: `E2E Schluessel Leitung ${short}`,
  });

  await page.goto(`/spieler?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Spieler & Team" })).toBeVisible();
  for (const name of ["Eins", "Zwei", "Drei", "Vier"].map((index) => `E2E Schluessel ${index} ${short}`)) {
    await page.getByLabel("Anzeigename", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }

  const boardName = `E2E Schluessel Board ${short}`;
  await page.goto(`/matches?organisation=${organizationId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
  await page.getByLabel("Neues Board").fill(boardName);
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await expect(
    page.locator("li").filter({ hasText: boardName }).filter({ hasText: "frei" }),
  ).toBeVisible();

  await page.goto(`/turniere/neu?organisation=${organizationId}`);
  await page.getByLabel("Format").selectOption("ROUND_ROBIN");
  await page.getByLabel("Name").fill(tournamentName);
  await page.getByLabel("Best of Legs").selectOption("1");
  await Promise.all([
    page.waitForURL(/\/turniere\/[^/?]+\?organisation=/u),
    page.getByRole("button", { name: "Turnier starten" }).click(),
  ]);
  await expect(page.getByRole("heading", { level: 1, name: tournamentName })).toBeVisible();
  const tournamentId = new URL(page.url()).pathname.split("/").at(-1);
  if (tournamentId === undefined) throw new Error("Expected tournament ID in dashboard URL.");

  // Turniere sind standardmässig privat (Task 6) -- keine Freigabe hier, der
  // Anzeige-Schluessel soll die Board-Ansicht auch OHNE sie oeffnen.
  const displayKeys = page.getByRole("region", { name: "Anzeige-Schlüssel" });
  await expect(displayKeys).toBeVisible();
  await displayKeys.getByLabel("Bezeichnung").fill(keyLabel);
  await displayKeys.getByRole("button", { name: "Schlüssel ausstellen" }).click();
  const freshSecretBlock = displayKeys.getByRole("alert");
  await expect(freshSecretBlock).toBeVisible();
  await expect(freshSecretBlock.getByText("Dieser Schlüssel wird nicht wieder angezeigt.")).toBeVisible();
  // Klartext: das zweite <p> im hervorgehobenen Feld (Bezeichnung, Klartext,
  // Hinweistext -- siehe `display-keys-panel.tsx`).
  const secret = await freshSecretBlock.locator("p").nth(1).textContent();
  if (secret === null || secret.trim().length === 0) throw new Error("Expected a display key secret in the panel.");

  // Board-ID und oeffentliche ID ueber dieselbe Dashboard-Route, die die
  // Kommandozentrale selbst laedt -- die Oberflaeche zeigt weder Board- noch
  // die interne Turnier-ID an, nur Namen (`tournamentId` oben ist die interne
  // ID aus der Dashboard-Adresse, keine gueltige `publicId`).
  const apiOrigin = `http://localhost:${process.env.PLAYWRIGHT_API_PORT ?? 3_101}/api/v1`;
  const dashboard = await page.evaluate(
    async ({ apiOrigin, organizationId, tournamentId }) => {
      const response = await fetch(
        `${apiOrigin}/organizations/${organizationId}/tournaments/${tournamentId}/dashboard`,
        { credentials: "include" },
      );
      return (await response.json()) as {
        readonly tournament: { readonly publicId: string };
        readonly boards: readonly { readonly boardId: string; readonly boardName: string }[];
      };
    },
    { apiOrigin, organizationId, tournamentId },
  );
  const boardId = dashboard.boards.find((board) => board.boardName === boardName)?.boardId;
  if (boardId === undefined) throw new Error("Expected the created board in the tournament dashboard.");

  const boardUrl = `/live/${dashboard.tournament.publicId}/board/${boardId}`;

  // Ohne den Schluessel bleibt das private Turnier unsichtbar.
  const anonymousWithoutKey = await browser.newContext();
  try {
    const anonymousPage = await anonymousWithoutKey.newPage();
    await anonymousPage.goto(boardUrl);
    await expect(anonymousPage.getByText("Turnier nicht gefunden.")).toBeVisible();
  } finally {
    await anonymousWithoutKey.close();
  }

  // Mit dem Schluessel in der Adresse oeffnet sich dieselbe Board-Ansicht --
  // ohne jede Freigabe des Turniers.
  const anonymousWithKey = await browser.newContext();
  try {
    const anonymousPage = await anonymousWithKey.newPage();
    await anonymousPage.goto(`${boardUrl}?k=${encodeURIComponent(secret.trim())}`);
    await expect(anonymousPage.getByRole("heading", { level: 1, name: tournamentName })).toBeVisible();
    // Der Schluessel verschwindet aus der Adresse (Task 6, Step 4).
    await expect(anonymousPage).toHaveURL(new RegExp(`${boardUrl.replace(/[/]/gu, "\\/")}$`));
  } finally {
    await anonymousWithKey.close();
  }
});
