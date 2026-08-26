import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("a club can complete a match and start a generated tournament match", async ({
  page,
}) => {
  const suffix = randomUUID();
  const email = `e2e-${suffix}@example.test`;
  const organizationName = `E2E Club ${suffix.slice(0, 8)}`;
  const organizationSlug = `e2e-club-${suffix}`;

  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Dart Ost - Plattform" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Need an account? Register" }).click();
  await page.getByLabel("Name").fill("E2E Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("E2ePassword123!");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText(email)).toBeVisible();
  await page.getByPlaceholder("Club name").fill(organizationName);
  await page.getByPlaceholder("club-slug").fill(organizationSlug);
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: organizationName }),
  ).toBeVisible();
  await page.getByPlaceholder("Display name").fill("E2E Player One");
  await page.getByPlaceholder("Nickname (optional)").fill("The Test One");
  await page.getByRole("button", { name: "Add player" }).click();
  await expect(page.getByText("E2E Player One", { exact: true }).first()).toBeVisible();
  await page.getByPlaceholder("Display name").fill("E2E Player Two");
  await page.getByPlaceholder("Nickname (optional)").fill("The Test Two");
  await page.getByRole("button", { name: "Add player" }).click();
  await expect(page.getByText("E2E Player Two", { exact: true }).first()).toBeVisible();

  await page.getByLabel("Board name").fill("E2E Board");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(/E2E Board: AVAILABLE/u)).toBeVisible();
  await page.getByLabel("Player one").selectOption({ label: "E2E Player One" });
  await page.getByLabel("Player two").selectOption({ label: "E2E Player Two" });
  await page.getByLabel("Starting player").selectOption({ label: "E2E Player One starts" });
  await page.getByLabel("Best of legs").selectOption("1");
  await page.getByLabel("Board", { exact: true }).selectOption({ label: "E2E Board" });
  await page.getByRole("button", { name: "Start match" }).click();

  const record = async (score: number, expectedRest: number, checkoutDouble?: number) => {
    await page.getByLabel("Visit score").fill(String(score));
    if (checkoutDouble !== undefined) await page.getByLabel("Checkout double").fill(String(checkoutDouble));
    await page.getByRole("button", { name: "Record" }).click();
    await expect(page.getByLabel(`E2E Player One remaining score`)).toHaveText(String(expectedRest));
  };

  await record(180, 321);
  await page.getByRole("button", { name: "Undo last visit" }).click();
  await expect(page.getByLabel("E2E Player One remaining score")).toHaveText("501");
  await record(180, 321);
  await page.getByLabel("Visit score").fill("60");
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByLabel("E2E Player Two remaining score")).toHaveText("441");
  await record(180, 141);
  await page.getByLabel("Visit score").fill("60");
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByLabel("E2E Player Two remaining score")).toHaveText("381");
  await record(141, 0, 12);
  await expect(page.getByText("Match complete")).toBeVisible();
  await expect(page.getByText("E2E Player One wins")).toBeVisible();

  for (const name of ["E2E Player Three", "E2E Player Four"]) {
    await page.getByPlaceholder("Display name").fill(name);
    await page.getByRole("button", { name: "Add player" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }

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

  await page.goto("/");
  await expect(page.getByRole("region", { name: "Match scoreboard" })).toBeVisible();
  const scoreTournamentVisit = async (score: number, checkoutDouble?: number) => {
    const visitScore = page.getByLabel("Visit score");
    await visitScore.fill(String(score));
    if (checkoutDouble !== undefined) {
      await page.getByLabel("Checkout double").fill(String(checkoutDouble));
    }
    await page.getByRole("button", { name: "Record" }).click();
    if (checkoutDouble === undefined) {
      await expect(visitScore).toHaveValue("");
    } else {
      await expect(page.getByText("Match complete")).toBeVisible();
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
});
