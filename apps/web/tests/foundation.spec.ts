import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("user can register, create an organization and add a player", async ({
  page,
}) => {
  const suffix = randomUUID();
  const email = `e2e-${suffix}@example.test`;
  const organizationName = `E2E Club ${suffix.slice(0, 8)}`;
  const organizationSlug = `e2e-club-${suffix}`;

  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Darts Platform" }),
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
  await page.getByPlaceholder("Display name").fill("E2E Player");
  await page.getByPlaceholder("Nickname (optional)").fill("The Test");
  await page.getByRole("button", { name: "Add player" }).click();

  await expect(page.getByText("E2E Player")).toBeVisible();
  await expect(page.getByText(/The Test · ACTIVE/u)).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Display name for E2E Player").fill("E2E Player Updated");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("E2E Player Updated")).toBeVisible();

  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText(/The Test · INACTIVE/u)).toBeVisible();
});
