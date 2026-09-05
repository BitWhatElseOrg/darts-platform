import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Öffnet das Einstellungs-Modal über das Zahnrad und schaltet die Eingabeart
 * um. Die Einstellung liegt geräte-/browserlokal (`scoreboard-settings.ts`,
 * `localStorage`) und bleibt für den Rest des Browserkontexts bestehen — ein
 * einmaliger Wechsel je `page` genügt für den ganzen Testlauf, auch über
 * mehrere geöffnete Matches hinweg.
 */
export async function switchInputMode(page: Page, mode: "Dart" | "Runde"): Promise<void> {
  await page.getByRole("button", { name: "Einstellungen" }).click();
  const dialog = page.getByRole("dialog", { name: "Einstellungen" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: mode }).click();
  await dialog.getByRole("button", { name: "Spiel fortsetzen" }).click();
  await expect(dialog).toHaveCount(0);
}

/**
 * Schaltet einen der Schalter im Einstellungs-Modal um. Der zugängliche Name
 * trägt den Zustand mit (`scoreboard-settings-dialog.tsx`, `SettingSwitch`:
 * „<Name>: JA" / „<Name>: NEIN"), deshalb wartet diese Funktion erst auf den
 * erwarteten Ausgangszustand und danach auf den erreichten Zielzustand — ein
 * Klick ins Blaue würde einen bereits passenden Schalter verstellen.
 */
export async function setScoreboardSwitch(page: Page, label: string, enabled: boolean): Promise<void> {
  await page.getByRole("button", { name: "Einstellungen" }).click();
  const dialog = page.getByRole("dialog", { name: "Einstellungen" });
  await expect(dialog).toBeVisible();
  const before = dialog.getByRole("switch", { name: `${label}: ${enabled ? "NEIN" : "JA"}` });
  await expect(before).toBeVisible();
  await before.click();
  await expect(dialog.getByRole("switch", { name: `${label}: ${enabled ? "JA" : "NEIN"}` })).toBeVisible();
  await dialog.getByRole("button", { name: "Spiel fortsetzen" }).click();
  await expect(dialog).toHaveCount(0);
}

/**
 * Tippt eine Rundensumme über das Ziffernfeld des Runden-Keypads und sendet
 * sie ab — der Nachfolger des früheren Freitextfelds `Aufnahmescore`
 * (`.fill(...)` + „Erfassen"), das der Moduswechsel (Task 8/9) durch die
 * zwei Keypads ersetzt hat. Ergibt die Summe rechnerisch genau den
 * Reststand und ist die Ausgangsregel nicht `SINGLE`, öffnet die Fläche
 * danach den Checkout-Schritt; den behandelt diese Funktion nicht, das
 * bleibt Sache der aufrufenden Stelle.
 */
export async function typeRoundScore(page: Page, points: number): Promise<void> {
  for (const digit of String(points)) {
    await page.getByRole("button", { name: `Ziffer ${digit}` }).click();
  }
  await page.getByRole("button", { name: "Aufnahme erfassen" }).click();
}

/**
 * Öffnet den Abbruch-Dialog über das Einstellungs-Modal. Seit Task 14 gibt
 * es keinen direkten „Match abbrechen"-Knopf mehr auf der Fläche selbst —
 * „SPIEL BEENDEN" sitzt im Einstellungs-Modal und öffnet den Abbruch-Dialog
 * darüber; beide bleiben absichtlich offen, bis der Abbruch gelingt (siehe
 * `match-scoreboard.tsx`, Kommentar bei `AbortMatchDialog`).
 */
export async function openAbortDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Einstellungen" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Einstellungen" });
  await expect(settingsDialog).toBeVisible();
  await settingsDialog.getByRole("button", { name: "Spiel beenden" }).click();
}

/**
 * Wählt die benötigten Darts im Checkout-Dialog. Seit Task 13 ist das kein
 * `<select>` mit dem Label „Benötigte Darts" mehr, sondern eine Gruppe aus
 * drei Knöpfen („1 Dart", „2 Darts", „3 Darts" — siehe `checkout-dialog.tsx`).
 */
export async function selectCheckoutDarts(dialog: Locator, darts: 1 | 2 | 3): Promise<void> {
  await dialog.getByRole("button", { name: `${darts} ${darts === 1 ? "Dart" : "Darts"}` }).click();
}
