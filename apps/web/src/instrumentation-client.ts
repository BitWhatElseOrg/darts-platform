import { z } from "zod";

// Zod prueft beim ersten Schema-Zugriff einmalig per `Function("")`, ob JIT-
// Kompilierung moeglich ist (Performance-Optimierung). Unter der erzwungenen
// CSP (kein 'unsafe-eval' in Production) schlaegt das fehl -- Zod faengt den
// Fehler bereits ab (kein Funktionsbruch), meldet aber einen echten
// `script-src`-Verstoss an `/api/v1/csp-reports`. `jitless` ist Zods eigenes
// Flag genau fuer "environments that disallow eval".
//
// `instrumentation-client.ts` ist Next.js' dedizierter Hook fuer genau
// diesen Fall: laut Next.js-Doku ("Execution timing") laeuft synchroner
// Top-Level-Code hier nach dem HTML-Dokument, aber vor jeder React-
// Hydration -- analog zum dort beschriebenen Polyfill-Muster. Die
// eigentlich tragende, staerkere Eigenschaft geht ueber diese Doku-
// Zusicherung hinaus: Next.js kompiliert diesen Code in seinen eigenen
// `main-app`-Bootstrap-Chunk, den jeder App-Entry-Chunk als Abhaengigkeit
// fuehrt und der ueber einen synchronen `require`-Pfad in `app-next.js`
// vor `appBootstrap`/`hydrate` laeuft -- das ist strukturell nachpruefbar
// (kompilierten Chunk-Inhalt inspizieren), kein Webpack-Bundling-Zufall
// mehr wie die vorherige Platzierung in `providers.tsx` (siehe
// `docs/adr/0014-csp-nonce-static-rendering.md`). `pnpm --filter
// @darts-platform/web test:e2e:prod` (Route `/`) faengt eine stille
// Regression hier auf (meldet `script-src`-`eval`-Verstoesse aus den
// Zod-Bundle-Kopien), falls diese Datei je entfernt oder ihr
// Konfigurationsaufruf gebrochen wird.
z.config({ jitless: true });
