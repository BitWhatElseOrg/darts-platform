import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { randomUUID } from "node:crypto";

import {
  createRegistrationInvitation,
  type RegistrationInvitationSeed,
} from "./registration-invitation";
import { applyMatchRules } from "./match-rules";
import {
  recordDartVisit, selectCheckoutDarts, switchInputMode, throwDart, typeRoundScore,
} from "./scoreboard-entry";
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

  // Ohne erfassten Wurf trägt die Rücktaste die Rücknahme der letzten
  // gesendeten Aufnahme — und benennt sie samt Punktzahl, statt als
  // unbeschrifteter Chevron dieselbe Taste zu bleiben
  // (`backspace-key.tsx`, `handleDartBackspace`).
  await page.getByRole("button", { name: "Letzte Aufnahme zurücknehmen: 140 Punkte" }).click();
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

/**
 * Befund F2: Unter Double In — der Vorgabe jedes voreingestellten
 * Ligawettbewerbs — sind die Punkte vor dem eröffnenden Doppel aus einer
 * blossen Rundensumme nicht zählbar; die Engine lehnt sie ab
 * (`DARTS_REQUIRED_FOR_DOUBLE_IN`). Die Fläche zeigt für genau diese Aufnahme
 * deshalb auch im Runden-Modus das Dart-Keypad und kehrt danach von selbst
 * zurück.
 */
test("the round mode records the opening visit dart by dart under double in", async ({ page }) => {
  const { organizationId, playerOneName } = await openScoreboard(page, "doublein");
  await applyMatchRules(organizationId, { inRule: "DOUBLE" });
  await expect(page.getByText("501 Double In / Double Out")).toBeVisible({ timeout: 15_000 });

  await switchInputMode(page, "Runde");

  // Vor der Eröffnung: Dart-Keypad samt Begründung, kein Ziffernfeld.
  await expect(page.getByText("Double In: die Eröffnungsaufnahme wird Wurf für Wurf erfasst", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Single 20" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ziffer 1" })).toHaveCount(0);

  // D20 eröffnet, T20 zählt dazu: 100 geworfen wie angerechnet.
  await recordDartVisit(page, ["D20", "T20", "MISS"]);
  await expect(page.getByLabel(`${playerOneName}, Restscore`)).toHaveText("401");

  // Die Gegenseite hat noch nicht eröffnet und bleibt beim Dart-Keypad.
  await expect(page.getByRole("button", { name: "Single 20" })).toBeVisible();
  await recordDartVisit(page, ["MISS", "MISS", "MISS"]);

  // Zurück am Oche und eröffnet: das Ziffernfeld zählt weiter, der Hinweis ist weg.
  await expect(page.getByRole("button", { name: "Ziffer 1" })).toBeVisible();
  await expect(page.getByText("Double In: die Eröffnungsaufnahme", { exact: false })).toHaveCount(0);
  await typeRoundScore(page, 180);
  await expect(page.getByLabel(`${playerOneName}, Restscore`)).toHaveText("221");
});

/**
 * Befund F2: Unter Master Out schliesst auch ein Triple das Leg
 * (Reglement 1.1, Klasse B). `checkoutDouble` kann kein Triple kodieren, das
 * Finish ging deshalb ohne Belegfeld raus und fiel seit
 * `CHECKOUT_DETAIL_REQUIRED` durch. Der Dialog sendet unter Master Out
 * stattdessen `checkoutSegment`.
 */
test("the round mode finishes on a treble under master out", async ({ page }) => {
  const { organizationId, playerOneName, playerTwoName } = await openScoreboard(page, "masterout");
  await applyMatchRules(organizationId, { outRule: "MASTER" });
  await expect(page.getByText("501 Straight In / Master Out")).toBeVisible({ timeout: 15_000 });

  await switchInputMode(page, "Runde");
  const scoreOne = page.getByLabel(`${playerOneName}, Restscore`);
  const scoreTwo = page.getByLabel(`${playerTwoName}, Restscore`);

  /**
   * Eine Rundensumme absenden und auf die Übernahme warten: die Fläche leert
   * das Ziffernfeld nur bei tatsächlichem Erfolg (`match-scoreboard.tsx`,
   * `submitJustSucceeded`), „Aufnahme erfassen" ist danach gesperrt.
   */
  const record = async (points: number) => {
    await typeRoundScore(page, points);
    // "Ziffer 0" statt "Rücktaste": die trägt bei leerer Eingabe die
    // Rücknahme und heisst dann nach deren Punktzahl (`backspace-key.tsx`).
    await expect(page.getByRole("button", { name: "Ziffer 0" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Aufnahme erfassen" })).toBeDisabled();
  };

  await record(180);
  await expect(scoreOne).toHaveText("321");
  await record(0);
  await expect(scoreTwo).toHaveText("501");
  await record(180);
  await expect(scoreOne).toHaveText("141");
  await record(0);
  await record(81);
  await expect(scoreOne).toHaveText("60");
  await record(0);

  // 60 auf 0: der Checkout-Schritt bietet unter Master Out auch Triples an.
  await typeRoundScore(page, 60);
  const dialog = page.getByRole("dialog", { name: "Checkout erfassen" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Checkout-Feld").selectOption("T20");
  await selectCheckoutDarts(dialog, 1);
  await dialog.getByRole("button", { name: "Checkout speichern" }).click();

  await expect(page.getByText("Match beendet")).toBeVisible();
  await expect(page.getByText(`${playerOneName} gewinnt`)).toBeVisible();
});

/**
 * Reglement 2.2.9: beim Entscheidungsdoppel (sudden death) wird schon der
 * Anwurf von Leg eins ausgebullt. Bis zu diesem Test hatte der Entscheid
 * keinen Weg durch die Oberflaeche — `POST .../leg-start` war nur per API
 * ausloesbar, und die Flaeche startete stillschweigend auf Sitz eins.
 */
test("the scoreboard demands the bull-off before the first leg of a decider", async ({ page }) => {
  const { organizationId, playerTwoName } = await openScoreboard(page, "anwurf");
  await applyMatchRules(organizationId, { bullOffFromLegOne: true });

  // Die Flaeche fragt den Matchzustand alle vier Sekunden neu ab; der Dialog
  // erscheint, sobald die geaenderte Regel angekommen ist.
  const dialog = page.getByRole("dialog", { name: /Anwurf ausbullen/ });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Single 20" })).toBeDisabled();

  await dialog.getByRole("button", { name: playerTwoName }).click();

  await expect(dialog).toHaveCount(0);
  // Die ausgebullte Seite ist am Wurf, nicht die vorbelegte Heimseite.
  await expect(page.getByText(`${playerTwoName} (am Wurf)`)).toBeAttached();
  await expect(page.getByRole("button", { name: "Single 20" })).toBeEnabled();
});

/**
 * Die Rücknahme hatte bis zum Wegfall ihres eigenen Knopfes dessen Sperren
 * (`disabled={undoPending || !online}`) und dessen Bedingung (nur bei
 * rücknehmbarer Aufnahme sichtbar). Beides hängt jetzt an der Rücktaste des
 * Keypads, die dafür eine zweite sichtbare Identität samt Punktzahl trägt
 * (`backspace-key.tsx`). Dieser Fall hält beide Identitäten samt Sperren
 * fest — sonst wäre die einzige destruktive Alltagsfunktion der Fläche
 * wieder unbeschriftet und offline wirkungslos.
 */
test("the backspace key carries the undo and stays locked offline", async ({ page }) => {
  const { playerOneName } = await openScoreboard(page, "undo");
  await switchInputMode(page, "Runde");

  // Ohne Aufnahme gibt es nichts zurückzunehmen: gesperrt, und der Name sagt
  // warum — vorher antwortete der Server auf denselben Druck NOTHING_TO_UNDO.
  await expect(page.getByRole("button", { name: "Keine Aufnahme zum Zurücknehmen" })).toBeDisabled();

  await typeRoundScore(page, 81);
  const score = page.getByLabel(`${playerOneName}, Restscore`);
  await expect(score).toHaveText("420");

  // Zweite Identität: die Taste benennt die Handlung und die Punktzahl.
  const undoKey = page.getByRole("button", { name: "Letzte Aufnahme zurücknehmen: 81 Punkte" });
  await expect(undoKey).toBeEnabled();

  // Bei angefangener Eingabe ist es wieder die gewöhnliche Rücktaste, und sie
  // nimmt nur die Ziffer zurück.
  await page.getByRole("button", { name: "Ziffer 6" }).click();
  const backspace = page.getByRole("button", { name: "Rücktaste" });
  await expect(backspace).toBeEnabled();
  await backspace.click();
  await expect(score).toHaveText("420");
  await expect(undoKey).toBeVisible();

  // Offline geht `undoVisit` bewusst nicht in die Warteschlange
  // (use-match-scoring.ts) und könnte nur fehlschlagen: gesperrt.
  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(undoKey).toBeDisabled();
  await page.context().setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(undoKey).toBeEnabled();

  await undoKey.click();
  await expect(score).toHaveText("501");
  await expect(page.getByRole("button", { name: "Keine Aufnahme zum Zurücknehmen" })).toBeDisabled();
});

/**
 * Die Aktionszeile beider Keypads stand im scrollenden Bereich: auf einem
 * 360 x 640 grossen Boardgerät lagen Absendeknopf und Rücktaste 25 px unter
 * der Kante, im Dart-Modus DOUBLE und TRIPLE mit 9 von 56 px sichtbar — ohne
 * Doppel ist unter Double Out kein Leg zu beenden. Gemessen statt geschätzt:
 * der Fall prüft die Lage im Viewport, nicht das Aussehen.
 */
test("the keypad action row stays in view on a 360x640 board device", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await openScoreboard(page, "kleinesgeraet");

  const inView = async (name: string) => {
    const box = await page.getByRole("button", { name }).boundingBox();
    if (box === null) throw new Error(`Kein Kasten für "${name}".`);
    const viewport = page.viewportSize();
    if (viewport === null) throw new Error("Kein Viewport.");
    return box.y >= 0 && box.y + box.height <= viewport.height;
  };

  // Dart-Modus ist die Standardeingabe.
  expect(await inView("Umschalter DOUBLE")).toBe(true);
  expect(await inView("Umschalter TRIPLE")).toBe(true);

  await switchInputMode(page, "Runde");
  expect(await inView("Aufnahme erfassen")).toBe(true);
  expect(await inView("Ziffer 0")).toBe(true);
  expect(await inView("Ziffer 7")).toBe(true);
});
