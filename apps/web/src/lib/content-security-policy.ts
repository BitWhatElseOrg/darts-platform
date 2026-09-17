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
  /**
   * Pro Request neu erzeugt (siehe `proxy.ts`). Ersetzt `'unsafe-inline'`
   * fuer `script-src` -- Next.js' eigener Inline-Bootstrap traegt dieselbe
   * Nonce, sobald sie im CSP-Response-Header steht (siehe Task 1, Ergebnis 1).
   * Seit der CSP-Nonce-Nacharbeit (Plan 2026-09-08-csp-nonce-nacharbeit,
   * Task 1) traegt `script-src` zusaetzlich `'strict-dynamic'`, das
   * Host-/Schema-Quellen wie `'self'` fuer Skripte abschaltet und nur noch
   * per Nonce/Hash erlaubten Skripten sowie ihrer Vertrauens-Propagation
   * (inkl. `__webpack_nonce__` beim Chunk-Nachladen) folgt.
   */
  readonly nonce: string;
}

export function buildContentSecurityPolicy({
  allowEval,
  apiOrigin,
  nonce,
  reportUri,
}: ContentSecurityPolicyOptions): string {
  const websocketOrigin = apiOrigin.replace(/^http/u, "ws");
  const scriptSource = allowEval
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    scriptSource,
    "style-src 'self' 'unsafe-inline'",
    // QR-Codes der Board-Ansicht sind `data:`-URLs; das Profilbild kommt von
    // der API (`apiOrigin`), und seine Vorschau vor dem Speichern ist ein
    // `blob:`-Objekt-URL aus dem Zuschnitt im Browser (`avatar-upload.ts`).
    `img-src 'self' data: blob: ${apiOrigin}`,
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin} ${websocketOrigin}`,
    `report-uri ${reportUri}`,
    "report-to csp-endpoint",
  ].join("; ");
}
