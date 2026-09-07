import { expect, test } from "@playwright/test";

test("die Weboberflaeche liefert die Sicherheits-Header", async ({ page }) => {
  const response = await page.goto("/");
  if (response === null) {
    throw new Error("Für die Startseite kam keine Antwort zurück.");
  }
  const headers = response.headers();

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["strict-transport-security"]).toContain("max-age=31536000");
  expect(headers["permissions-policy"]).toContain("camera=()");

  const contentSecurityPolicy = headers["content-security-policy-report-only"];
  expect(contentSecurityPolicy).toBeDefined();
  expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
  expect(contentSecurityPolicy).toContain("object-src 'none'");
  // Erzwungen wird noch nicht: der harte Header darf nicht gesetzt sein.
  expect(headers["content-security-policy"]).toBeUndefined();

  // Die Meldungen laufen jetzt irgendwohin — ueber beide Wege, damit sowohl
  // Browser mit der alten `report-uri`-Form als auch solche mit der
  // Reporting-API melden. `report-to` ist ohne den Header wirkungslos.
  expect(contentSecurityPolicy).toContain("report-uri ");
  expect(contentSecurityPolicy).toContain("/api/v1/csp-reports");
  expect(contentSecurityPolicy).toContain("report-to csp-endpoint");
  expect(headers["reporting-endpoints"]).toContain('csp-endpoint="');
  expect(headers["reporting-endpoints"]).toContain("/api/v1/csp-reports");
});
