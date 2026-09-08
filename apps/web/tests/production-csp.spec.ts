import { expect, test } from "./fixtures";

/**
 * Prueft echten Produktivbuild-Verhalten, das `next dev` strukturell nicht
 * zeigen kann: kein `'unsafe-eval'`, keine vorgerenderten statischen Seiten
 * ohne Nonce (Task 4, `2026-09-08-csp-nonce.md`), und `'strict-dynamic'`
 * bricht clientseitige Navigation nicht (Task 1, dieser Plan).
 */
const previouslyStaticRoutes = ["/", "/offline", "/liga/begegnungen", "/live/begegnungen"];

for (const route of previouslyStaticRoutes) {
  test(`${route}: keine CSP-Verstoesse, keine unsafe-eval im Produktivbuild`, async ({ page }) => {
    // Der `cspViolations`-Fixture aus `./fixtures` ist `{ auto: true }` und
    // scheitert diesen Fall von sich aus, sobald der Browser waehrend des
    // Tests einen `securitypolicyviolation` meldet -- kein eigenes Assert
    // noetig (siehe `fixtures.ts:76`, kein bestehender Spec referenziert
    // `cspViolations` direkt).
    const response = await page.goto(route);
    if (response === null) {
      throw new Error(`Fuer ${route} kam keine Antwort zurueck.`);
    }

    const contentSecurityPolicy = response.headers()["content-security-policy"];
    expect(contentSecurityPolicy).toBeDefined();
    expect(contentSecurityPolicy).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy).toContain("'strict-dynamic'");
  });
}

test("clientseitige Navigation von /liga/begegnungen zurueck zu / verletzt strict-dynamic nicht", async ({
  page,
}) => {
  // Der Brief-Entwurf fuer diesen Fall (`window.history.pushState` gefolgt
  // von `page.goto`) loest keine clientseitige Navigation aus:
  // `pushState` allein benachrichtigt Next.js' Router nicht, und das
  // anschliessende `page.goto` ist ein zweiter vollstaendiger Seitenaufbau --
  // das deckt nichts ab, was der Fall oben (volle Ladevorgaenge je Route)
  // nicht schon prueft. Ersetzt durch einen echten Link-Klick.
  //
  // `/liga/begegnungen` rendert immer `notFound()` (siehe
  // `src/app/liga/begegnungen/page.tsx`), also die App-eigene
  // `not-found.tsx` -- die einen echten `next/link` "Zur Übersicht" nach `/`
  // traegt (`src/app/not-found.tsx`). Die Startseite ist zu Testbeginn noch
  // nicht geladen, ihr Client-Bundle (u. a. `ApplicationDashboard`, "use
  // client") muss also beim Klick per Webpack-Chunk nachgeladen werden --
  // genau der Fall, den `'strict-dynamic'` treffen wuerde, wenn die Nonce
  // beim dynamischen Chunk-Nachladen nicht mitgefuehrt wuerde. Keine der
  // beiden Seiten braucht einen API-Server.
  await page.goto("/liga/begegnungen");

  await page.getByRole("link", { name: "Zur Übersicht" }).click();

  await page.waitForURL("/");
  await expect(page.getByRole("heading", { name: "DartBase - Turnier Plattform" })).toBeVisible();
});
