import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";
import { switchInputMode } from "./scoreboard-entry";
import { signUpWithOrganization } from "./sign-up";

/**
 * Browser-Test der Vollbild-Scoringfläche selbst (Task 15): Kopfzeile,
 * Wurf-für-Wurf-Eingabe samt Bestätigungsfläche, Bust, Checkout, Rücknahme
 * und der Moduswechsel im Einstellungs-Modal. Die übrigen Matchbelange
 * (Offline-Warteschlange, Turnierintegration, Team-Begegnung) bleiben Sache
 * von `foundation.spec.ts` und `team-encounter.spec.ts` — die laufen seit
 * diesem Task über den Runden-Modus, weil ihr eigentlicher Prüfgegenstand
 * der Matchablauf ist, nicht das Keypad.
 */

const registrationSeeds: RegistrationInvitationSeed[] = [];

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

interface ScoreboardFixture {
  readonly organizationId: string;
  readonly playerOneName: string;
  readonly playerTwoName: string;
}

/**
 * Registrierung, zwei Spieler, ein Board und ein laufendes Best-of-1-Match
 * mit offener Scoringfläche — der gemeinsame Aufbau beider Tests dieser
 * Datei, nach dem Muster aus `team-encounter.spec.ts`.
 */
async function openScoreboard(page: Page, label: string): Promise<ScoreboardFixture> {
  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-${label}-${suffix}@example.test`;
  const playerOneName = `E2E ${label} Eins ${short}`;
  const playerTwoName = `E2E ${label} Zwei ${short}`;
  const boardName = `E2E ${label} Board ${short}`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);

  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken,
    email,
    organizationName: `E2E ${label} Club ${short}`,
    organizationSlug: `e2e-${label}-club-${suffix}`,
    ownerName: `E2E ${label} Ligaleitung`,
  });

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

  return { organizationId, playerOneName, playerTwoName };
}

/**
 * Ein einzelner Wurf auf dem Dart-Keypad. Der Umschalter gilt für genau
 * einen Wurf (`dart-entry.ts`, `MODIFIER`), muss also vor jedem Doppel und
 * jedem Triple neu gedrückt werden.
 */
async function throwDart(page: Page, dart: `S${number}` | `D${number}` | `T${number}` | "MISS"): Promise<void> {
  if (dart === "MISS") {
    await page.getByRole("button", { name: "Fehlwurf" }).click();
    return;
  }
  const segment = Number(dart.slice(1));
  if (dart.startsWith("T")) {
    await page.getByRole("button", { name: "Umschalter TRIPLE" }).click();
    await page.getByRole("button", { name: `Triple ${segment}`, exact: true }).click();
    return;
  }
  if (dart.startsWith("D")) {
    await page.getByRole("button", { name: "Umschalter DOUBLE" }).click();
    await page.getByRole("button", { name: `Doppel ${segment}`, exact: true }).click();
    return;
  }
  await page.getByRole("button", { name: `Single ${segment}`, exact: true }).click();
}

test("the fullscreen scoreboard records a dart-by-dart visit and switches input mode", async ({
  page,
}) => {
  const { playerOneName } = await openScoreboard(page, "scoreboard");

  // Kopfzeile zeigt Leg und laufende Runde.
  await expect(page.getByText("LEG 1", { exact: true })).toBeVisible();
  await expect(page.getByText("RUNDE 1", { exact: true })).toBeVisible();

  // Wurf-für-Wurf ist die Standardeingabe: Triple 20, Triple 20, Single 20.
  await throwDart(page, "T20");
  await throwDart(page, "T20");
  await throwDart(page, "S20");

  // Nach dem dritten Wurf erscheint die Bestätigungsfläche (Standard:
  // „Punktzahl bestätigen" ist an).
  await expect(page.getByRole("button", { name: "WEITER" })).toBeVisible();
  await expect(page.getByText("GEWORFEN")).toBeVisible();
  await expect(page.getByText("140", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "WEITER" }).click();

  // 501 - (60 + 60 + 20) = 361.
  await expect(page.getByLabel(`${playerOneName}, Restscore`)).toHaveText("361");

  // Rücktaste ohne erfassten Wurf nimmt die letzte Aufnahme serverseitig
  // zurück (match-scoreboard.tsx, `handleDartBackspace`).
  await page.getByRole("button", { name: "Rücktaste" }).click();
  await expect(page.getByLabel(`${playerOneName}, Restscore`)).toHaveText("501");

  // Zahnrad öffnen, auf Runde umschalten, SPIEL FORTSETZEN, Ziffernfeld
  // erscheint.
  await switchInputMode(page, "Runde");
  await expect(page.getByRole("button", { name: "Ziffer 1" })).toBeVisible();
});

/**
 * Befund der Abschlussrunde: der Dart-Modus war unterhalb einer einzigen
 * Aufnahme ungeprüft — und genau dort steckte der Fehler, der die Fläche
 * unter Double In unbedienbar machte. Dieser Test spielt ein ganzes Leg
 * Wurf für Wurf bis zum Checkout und nimmt dabei die beiden riskanten
 * Stellen mit: den Überwurf (Bust) samt gesperrten Segmenttasten und den
 * vorzeitigen Abschluss der Aufnahme auf dem Checkout-Doppel, der die
 * Aufnahme mit EINEM Dart beendet statt auf drei aufzufüllen.
 */
test("the fullscreen scoreboard plays a whole leg dart by dart, busting once", async ({ page }) => {
  const { playerOneName, playerTwoName } = await openScoreboard(page, "dartleg");
  const scoreOne = page.getByLabel(`${playerOneName}, Restscore`);
  const scoreTwo = page.getByLabel(`${playerTwoName}, Restscore`);

  /** Erfasst eine Aufnahme und bestätigt sie über die Bestätigungsfläche. */
  const visit = async (darts: readonly Parameters<typeof throwDart>[1][]) => {
    for (const dart of darts) await throwDart(page, dart);
    await page.getByRole("button", { name: "WEITER" }).click();
  };

  await visit(["T20", "T20", "T20"]);
  await expect(scoreOne).toHaveText("321");
  await visit(["MISS", "MISS", "MISS"]);
  await expect(scoreTwo).toHaveText("501");

  await visit(["T20", "T20", "T20"]);
  await expect(scoreOne).toHaveText("141");
  await visit(["MISS", "MISS", "MISS"]);

  // Überwurf: 141 - 60 - 60 - 60 ist negativ. Die Vorschau meldet den Bust
  // schon vor dem Absenden, und die Segmenttasten sind dabei gesperrt —
  // ein weiterer Wurf würde die abgeschlossene Aufnahme ohnehin nicht mehr
  // ändern (dart-keypad.tsx, `segmentsLocked`).
  await throwDart(page, "T20");
  await throwDart(page, "T20");
  await throwDart(page, "T20");
  await expect(page.getByText("BUST", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Eingabe korrigieren" }).click();
  await expect(page.getByRole("button", { name: "Single 20" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Rücktaste" })).toBeEnabled();
  // Rücktaste nimmt den dritten Wurf zurück, die Aufnahme ist wieder offen.
  await page.getByRole("button", { name: "Rücktaste" }).click();
  await expect(page.getByRole("button", { name: "Single 20" })).toBeEnabled();
  await throwDart(page, "T20");
  await page.getByRole("button", { name: "WEITER" }).click();
  // Der Bust lässt den Reststand stehen.
  await expect(scoreOne).toHaveText("141");
  await visit(["MISS", "MISS", "MISS"]);

  await visit(["T20", "T20", "S1"]);
  await expect(scoreOne).toHaveText("20");
  await visit(["MISS", "MISS", "MISS"]);

  // Checkout auf dem ersten Dart: die Aufnahme endet hier und wird NICHT
  // auf drei Würfe aufgefüllt — ein nachgeschobener Fehlwurf machte aus dem
  // Sieg sonst einen Bust (dart-entry.ts, `alreadyComplete`).
  await throwDart(page, "D10");
  await expect(page.getByRole("button", { name: "Single 20" })).toBeDisabled();
  await page.getByRole("button", { name: "WEITER" }).click();
  await expect(scoreOne).toHaveText("0");
  await expect(page.getByText("Match beendet")).toBeVisible();
  await expect(page.getByText(`${playerOneName} gewinnt`)).toBeVisible();

  // Die letzte Aufnahme ist mit einem Dart verbucht.
  await page.getByRole("button", { name: "Einstellungen" }).click();
  const settings = page.getByRole("dialog", { name: "Einstellungen" });
  await expect(settings).toBeVisible();
  await expect(settings.getByText(`${playerOneName} · 1 Darts`).first()).toBeVisible();
});
