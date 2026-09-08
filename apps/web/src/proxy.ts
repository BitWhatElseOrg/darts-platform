import { NextResponse, type NextRequest } from "next/server";

import { buildContentSecurityPolicy } from "@/lib/content-security-policy";

// Die Seite spricht ausser mit sich selbst nur mit der API — per HTTP und per
// WebSocket. Beide Ziele stammen aus derselben konfigurierten URL, damit die
// Policy in Development, Preview und Production automatisch stimmt.
const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL;
const apiOrigin = configuredApiUrl === undefined ? "http://localhost:3001" : new URL(configuredApiUrl).origin;
// Ziel der Verstoss-Meldungen. Es liegt auf der API, nicht auf der Seite
// selbst: Next.js hat keinen Ort fuer einen Endpunkt, der aus der Policy
// heraus angesprochen wird, und die API traegt bereits Rate-Limiting,
// strukturiertes Logging und die einheitliche Fehlerform.
const cspReportUri = `${apiOrigin}/api/v1/csp-reports`;

/**
 * Zweite Stufe: erzwingend. Report-Only hat seine Aufgabe erfuellt.
 *
 * Umstellungskriterium war (M5), dass echte Meldungen zeigen, dass nichts
 * Notwendiges blockiert wuerde. Der Beleg kam nicht aus dem Betrieb — dort
 * besucht niemand planmaessig alle Seiten — sondern aus der E2E-Suite: die
 * Wache in `tests/fixtures.ts` horcht auf `securitypolicyviolation` und
 * meldete am 2026-09-07 ueber alle 15 Faelle hinweg ausschliesslich
 * `script-src → eval` aus dem Uebersetzer von `next dev`. Keine einzige
 * Meldung zu `img-src`, `connect-src`, `style-src`, `font-src` oder
 * `default-src`. Die Wache bleibt stehen und haelt den Beleg aufrecht.
 *
 * `'unsafe-eval'` traegt deshalb nur der Entwicklungsserver
 * (`content-security-policy.ts`), der Produktionsbuild kennt es nicht.
 *
 * Die Nonce wird hier -- in `proxy.ts` -- pro Request neu erzeugt, weil
 * `headers()` in `next.config.ts` nur statisch je Pfad greift, nicht je
 * Anfrage. Next.js liest die Nonce selbst aus dem CSP-Response-Header fuer
 * seinen eigenen Inline-Bootstrap (Task 1, Ergebnis 1 — bestaetigt).
 *
 * Gemeldet wird weiter — `report-uri` und `report-to` gelten auch unter der
 * erzwungenen Richtlinie. Was jetzt auffaellt, ist etwas, das ein Browser
 * tatsaechlich blockiert hat.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID();
  const contentSecurityPolicy = buildContentSecurityPolicy({
    apiOrigin,
    reportUri: cspReportUri,
    allowEval: process.env.NODE_ENV !== "production",
    nonce,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  // Benennt, wohin `report-to csp-endpoint` zeigt. Ohne diesen Header ist die
  // Direktive wirkungslos, und nur `report-uri` traegt noch.
  response.headers.set("Reporting-Endpoints", `csp-endpoint="${cspReportUri}"`);
  return response;
}

export const config = {
  // Statische Assets und interne Next.js-Pfade brauchen keine Nonce.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
