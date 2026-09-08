import helmet from "@fastify/helmet";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

/**
 * Sicherheits-Header der API (ARCHITECTURE §30). Die CORS-Allowlist aus
 * `main.ts` bleibt unangetastet; helmet ergaenzt sie, es ersetzt sie nicht.
 *
 * `same-site` bei der Cross-Origin-Resource-Policy passt zum Betrieb:
 * `dartbase.ch` und `api.dartbase.ch` teilen sich denselben registrierbaren
 * Namen, lokal teilen sich Web und API `localhost`. `cross-origin` waere die
 * Einladung an beliebige fremde Seiten, API-Antworten einzubetten.
 *
 * Die Content Security Policy ist hier hart: die API liefert ausschliesslich
 * JSON, es gibt kein Dokument, das Skripte oder Stile nachladen duerfte.
 */
export async function registerSecurityHeaders(
  app: NestFastifyApplication,
): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'none'"],
        "form-action": ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    // Ein Jahr, Subdomains eingeschlossen. `preload` bleibt aus: die Aufnahme
    // in die Browser-Liste ist praktisch unumkehrbar und gehoert nicht in
    // einen Sicherheits-Fix, sondern in eine bewusste Betriebsentscheidung.
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: false },
    referrerPolicy: { policy: "no-referrer" },
    xFrameOptions: { action: "deny" },
    // `xContentTypeOptions` (nosniff) ist in helmet standardmaessig aktiv und
    // wird hier nur der Vollstaendigkeit halber ausgeschrieben.
    xContentTypeOptions: true,
  });
}
