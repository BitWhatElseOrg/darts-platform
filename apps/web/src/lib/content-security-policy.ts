/**
 * Baut die Content-Security-Policy der Weboberflaeche.
 *
 * Ausgelagert aus `next.config.ts`, damit die eine Entscheidung, die sich
 * zwischen Development und Production unterscheidet — `'unsafe-eval'` —
 * geprueft werden kann, statt nur im Build sichtbar zu sein.
 */
export interface ContentSecurityPolicyOptions {
  /** Herkunft der API; Ziel von `connect-src` per HTTP und WebSocket. */
  readonly apiOrigin: string;
  /** Adresse, an die der Browser Verstoesse meldet. */
  readonly reportUri: string;
  /**
   * Nur im Entwicklungsserver wahr. `next dev` uebersetzt Module zur Laufzeit
   * und fuehrt sie ueber `eval` aus — unter der erzwungenen Richtlinie stuende
   * sonst die Oberflaeche still. Der Produktionsbuild kennt kein `eval`; die
   * E2E-Suite hat das mit 19458 Meldungen im Entwicklungsmodus und keiner
   * einzigen anderen Direktive belegt (2026-09-07).
   */
  readonly allowEval: boolean;
}

export function buildContentSecurityPolicy({
  apiOrigin,
  reportUri,
  allowEval,
}: ContentSecurityPolicyOptions): string {
  const websocketOrigin = apiOrigin.replace(/^http/u, "ws");
  // `'unsafe-inline'` bleibt: Next.js liefert seinen Bootstrap inline aus, und
  // eine Nonce setzte eine eigene Middleware auf jeder Anfrage voraus.
  const scriptSource = allowEval
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    scriptSource,
    "style-src 'self' 'unsafe-inline'",
    // QR-Codes der Board-Ansicht sind `data:`-URLs.
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin} ${websocketOrigin}`,
    `report-uri ${reportUri}`,
    "report-to csp-endpoint",
  ].join("; ");
}
