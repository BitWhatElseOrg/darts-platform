"use client";

import { z } from "zod";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { PwaRegistration } from "./pwa-registration";

// Zod prueft beim ersten Schema-Zugriff einmalig per `Function("")`, ob JIT-
// Kompilierung moeglich ist (Performance-Optimierung). Unter der erzwungenen
// CSP (kein 'unsafe-eval' in Production) schlaegt das fehl -- Zod faengt den
// Fehler bereits ab (kein Funktionsbruch), meldet aber einen echten
// `script-src`-Verstoss an `/api/v1/csp-reports`. `jitless` ist Zods eigenes
// Flag genau fuer "environments that disallow eval" -- vermeidet den Test
// von vornherein, statt ihn scheitern zu lassen. Muss vor der ersten
// Zod-Validierung im Browser gesetzt sein; `Providers` ist die erste
// clientseitige Komponente, die jede Seite rendert.
//
// Ehrlicher Vorbehalt: diese Platzierung funktioniert heute nur, weil
// Webpack `providers.tsx` (einziger Importer: `layout.tsx`) direkt in den
// frueh geladenen Layout-Chunk kompiliert, statt in einen eigenen, mit
// anderen Chunks um Ladezeit konkurrierenden Shared-Chunk. Next.js liefert
// alle Chunk-Skripte als `async`, ohne Ausfuehrungsreihenfolge zwischen
// getrennt geladenen Chunks zu garantieren -- das ist eine beobachtete
// Bundling-Eigenschaft dieses Builds, keine von Next.js zugesicherte
// Garantie. Wird `environment.ts`/`auth-client.ts`/`api-client.ts` o. Ae.
// kuenftig so geaendert, dass sie in einen eigenen, unabhaengig geladenen
// Chunk extrahiert werden (z. B. weil mehr Module sie importieren), kann
// das diese Reihenfolge stillschweigend brechen. Vollstaendige Analyse und
// robustere Alternativen (synchrones Inline-Head-Skript, Webpack-Config):
// `docs/superpowers/plans/2026-09-08-tier3-backlog-und-rueckfragen.md`.
z.config({ jitless: true });

interface ProvidersProps {
  readonly children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: true,
            retry: 1,
            staleTime: 5_000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}><PwaRegistration />{children}</QueryClientProvider>
  );
}
