import { test as base, expect } from "@playwright/test";

/**
 * Ein CSP-Verstoss, wie ihn der Browser im Ereignis `securitypolicyviolation`
 * meldet. Das Ereignis feuert auch bei `Content-Security-Policy-Report-Only`
 * (`disposition: "report"`), deshalb sieht diese Wache Verstoesse, bevor die
 * Richtlinie erzwungen wird.
 */
interface CspViolation {
  readonly directive: string;
  readonly blockedUri: string;
  readonly sourceFile: string | null;
  readonly documentUri: string;
}

declare global {
  interface Window {
    readonly __reportCspViolation?: (violation: CspViolation) => void;
  }
}

/**
 * Playwright-Test mit einer Wache auf CSP-Verstoesse. Sie haengt automatisch
 * an jeder Seite: laeuft ein Fall durch einen Ablauf, der eine Ressource
 * ausserhalb der Richtlinie laedt, scheitert er hier — und zwar mit der
 * Direktive und der Quelle im Klartext.
 *
 * Der Grund ist die Umstellung von Report-Only auf erzwingend: erzwungen
 * werden darf erst, wenn belegt ist, dass nichts Notwendiges blockiert wird.
 * Produktionsmeldungen belegen das nur fuer die Seiten, die jemand zufaellig
 * besucht hat; diese Suite geht die Abläufe planmaessig durch und haelt den
 * Beleg danach dauerhaft aufrecht.
 */
export const test = base.extend<{ cspViolations: readonly CspViolation[] }>({
  cspViolations: [
    async ({ page }, use) => {
      const violations: CspViolation[] = [];

      await page.exposeFunction("__reportCspViolation", (violation: CspViolation) => {
        violations.push(violation);
      });
      // `addInitScript` laeuft vor jedem Dokument, also auch nach einer
      // Navigation — ein Zuhoerer, den erst der Testkoerper setzt, verpasst
      // die Verstoesse des ersten Seitenaufbaus.
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          window.__reportCspViolation?.({
            directive: event.effectiveDirective,
            blockedUri: event.blockedURI,
            sourceFile: event.sourceFile === "" ? null : event.sourceFile,
            documentUri: event.documentURI,
          });
        });
      });

      await use(violations);

      expect(
        violations,
        `Die Seite hat gegen die Content-Security-Policy verstossen:\n${violations
          .map((v) => `  ${v.directive} → ${v.blockedUri} (${v.sourceFile ?? "ohne Quelle"})`)
          .join("\n")}`,
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
