import { expect, test } from "./fixtures";

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

  const contentSecurityPolicy = headers["content-security-policy"];
  expect(contentSecurityPolicy).toBeDefined();
  expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
  expect(contentSecurityPolicy).toContain("object-src 'none'");
  // Erzwungen seit 2026-09-07: der Report-Only-Header darf nicht mehr
  // danebenstehen, sonst wird zweimal geprueft und nur einmal blockiert.
  expect(headers["content-security-policy-report-only"]).toBeUndefined();
  // Dieser Lauf faehrt `next dev`, und dessen Uebersetzer braucht `eval`. Dass
  // der Produktionsbuild es nicht bekommt, prueft
  // `src/lib/content-security-policy.spec.ts` — hier waere es nicht pruefbar.
  expect(contentSecurityPolicy).toContain("'unsafe-eval'");

  // Gemeldet wird weiterhin, auch unter der erzwungenen Richtlinie — ueber
  // beide Wege, damit sowohl Browser mit der alten `report-uri`-Form als auch
  // solche mit der Reporting-API melden. `report-to` ist ohne den Header
  // wirkungslos.
  expect(contentSecurityPolicy).toContain("report-uri ");
  expect(contentSecurityPolicy).toContain("/api/v1/csp-reports");
  expect(contentSecurityPolicy).toContain("report-to csp-endpoint");
  expect(headers["reporting-endpoints"]).toContain('csp-endpoint="');
  expect(headers["reporting-endpoints"]).toContain("/api/v1/csp-reports");
});
