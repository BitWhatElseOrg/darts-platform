import { expect, type Page } from "@playwright/test";

export interface SignUpResult {
  readonly organizationId: string;
}

/**
 * Registrierung, Einladung und Organisation über die Oberfläche. Die
 * Organisations-ID steht danach in der Adresse jeder Kachel der Übersicht;
 * ein Test braucht sie, um Seiten unabhängig von der Auswahl anzuspringen.
 *
 * `foundation.spec.ts` führt denselben Ablauf weiterhin selbst, weil er dort
 * zusätzlich das Ausklappen und die Label-Zuordnung des Organisations-
 * formulars zusichert.
 */
export async function signUpWithOrganization(
  page: Page,
  input: {
    readonly claimToken: string;
    readonly email: string;
    readonly organizationName: string;
    readonly organizationSlug: string;
    readonly ownerName: string;
  },
): Promise<SignUpResult> {
  await page.goto("/");
  await page.getByRole("button", { name: "Eingeladen? Konto erstellen" }).click();
  await page.getByLabel("Name").fill(input.ownerName);
  await page.getByLabel("E-Mail").fill(input.email);
  await page.getByLabel("Passwort").fill("E2ePassword123!");
  await page.getByLabel("Einladungscode").fill(input.claimToken);
  await page.getByRole("button", { name: "Konto erstellen" }).click();

  await expect(page.getByText(input.email)).toBeVisible();
  await page.getByLabel("Einladungscode").fill(input.claimToken);
  await page.getByRole("button", { name: "Annehmen" }).click();
  await expect(page.getByRole("link", { name: "Turnierleitung" })).toBeVisible();

  // Das Formular ist eingeklappt: die Neuanlage ist ein seltener
  // Betriebsvorgang und belegt im Panel keinen Dauerplatz mehr.
  await page.getByRole("button", { name: "Neue Organisation" }).click();
  const organizationForm = page.locator("#organization-create form");
  await organizationForm.getByLabel("Organisationsname").fill(input.organizationName);
  await organizationForm.getByLabel("Organisationskürzel").fill(input.organizationSlug);
  await page.getByRole("button", { name: "Erstellen", exact: true }).click();
  await expect(page.getByRole("heading", { name: input.organizationName })).toBeVisible();

  const teamsHref = await page
    .getByRole("link", { name: /Mannschaften und Kader/u })
    .getAttribute("href");
  const organizationId =
    teamsHref === null ? null : new URL(teamsHref, page.url()).searchParams.get("organisation");
  if (organizationId === null) {
    throw new Error("Expected the dashboard tiles to carry the organization id.");
  }
  return { organizationId };
}
