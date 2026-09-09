// apps/web/src/instrumentation-client.ts
import { z } from "zod";

// Zod prueft beim ersten Schema-Zugriff einmalig per `Function("")`, ob JIT-
// Kompilierung moeglich ist (Performance-Optimierung). Unter der erzwungenen
// CSP (kein 'unsafe-eval' in Production) schlaegt das fehl -- Zod faengt den
// Fehler bereits ab (kein Funktionsbruch), meldet aber einen echten
// `script-src`-Verstoss an `/api/v1/csp-reports`. `jitless` ist Zods eigenes
// Flag genau fuer "environments that disallow eval".
//
// `instrumentation-client.ts` ist Next.js' dedizierter Hook fuer genau
// diesen Fall: garantiert nach dem HTML-Dokument, aber vor jeder
// React-Hydration ausgefuehrt (Next.js-Doku, "Execution timing",
// analog zum dort beschriebenen Polyfill-Muster). Next.js kompiliert
// diesen Code in seinen eigenen `main-app`-Bootstrap-Chunk -- eine vom
// Framework zugesicherte Ausfuehrungsreihenfolge, nicht ein
// Webpack-Bundling-Zufall wie die vorherige Platzierung in
// `providers.tsx` (siehe `docs/adr/0014-csp-nonce-static-rendering.md`).
z.config({ jitless: true });
