# ADR 0014: CSP-Nonce zwingt fünf Routen auf dynamisches Rendering

**Status:** Accepted
**Datum:** 08. September 2026

## Kontext

`docs/superpowers/plans/2026-09-08-csp-nonce.md` ersetzt `'unsafe-inline'` in
`script-src` durch eine pro Anfrage erzeugte Nonce, die eine neue
`proxy.ts` (vormals als `middleware.ts` geplant — siehe unten) in den
CSP-Response-Header schreibt. Next.js liest diese Nonce automatisch aus dem
Header und hängt sie an seinen eigenen Inline-Bootstrap (den
RSC-Streaming-Payload, `self.__next_f.push(...)`).

Das funktioniert nur bei dynamisch gerenderten Seiten. Statisch vorgerenderte
Seiten (Next.js `○`) werden einmalig beim Build erzeugt — zu diesem
Zeitpunkt existiert keine Anfrage und damit keine Nonce. Ihr HTML enthält die
Inline-Skripte deshalb ganz ohne `nonce`-Attribut, für die gesamte Lebensdauer
des Deployments. Eine Nonce-CSP ohne `'unsafe-inline'` blockiert diese
Skripte dann bei jedem Aufruf — bestätigt durch Inspektion des
Produktivbuilds (`apps/web/.next/server/app/index.html`): zwei Inline-`<script>`-Tags
ohne jedes Attribut.

Betroffen waren beim Verfassen dieser ADR fünf Routen (Next.js Build-Ausgabe,
Spalte `○`):

- `/` (`apps/web/src/app/page.tsx`)
- `/_not-found` (`apps/web/src/app/not-found.tsx`)
- `/liga/begegnungen` (`apps/web/src/app/liga/begegnungen/page.tsx`, rendert
  immer `notFound()`)
- `/live/begegnungen` (`apps/web/src/app/live/begegnungen/page.tsx`, ebenso)
- `/offline` (`apps/web/src/app/offline/page.tsx`) — zusätzlich brisant, weil
  `public/sw.js` diese Seite beim Service-Worker-Install aktiv vorab cached
  (`SHELL`-Liste) und bei jedem gescheiterten Navigations-Request aus dem
  Cache serviert.

(`/manifest.webmanifest` ist ebenfalls `○`, aber ein JSON-Dokument ohne
Skripte — nicht betroffen.)

## Entscheidung

Diese fünf Routen erhalten `export const dynamic = "force-dynamic";`, damit
sie bei jeder Anfrage — auch beim einmaligen Service-Worker-Fetch von
`/offline` — serverseitig mit einer frischen, zum jeweiligen
CSP-Response-Header passenden Nonce gerendert werden. Alle übrigen Routen
bleiben unverändert (grösstenteils ohnehin schon `ƒ`, dynamisch).

Verworfene Alternativen:

- **Global per `connection()` im Root-Layout auf dynamisch zwingen:** robuster
  gegen künftige neue statische Routen, aber ein app-weiter
  Performance-Eingriff für einen Fund, der nur fünf konkrete Routen betrifft.
- **`'unsafe-inline'` als Ausnahme für genau diese Routen behalten:**
  kein Anwendungscode-Eingriff, aber untergräbt den Zweck des Plans genau auf
  der Startseite — der Route mit dem grössten Publikum.
- **Subresource Integrity (SRI, experimentell in dieser Next.js-Version):**
  einzige Option, die statische Generierung erhält, aber ein eigenständiges,
  grösseres Architekturprogramm — nicht die kleinste sinnvolle Änderung für
  diesen Befund.

## Konsequenzen

- Diese fünf Seiten verlieren statische Generierung/Caching. Bei allen fünf
  ist das inhaltlich unkritisch: `/`, `/_not-found` und `/offline` sind
  leichtgewichtige, seltene Seiten ohne datengetriebenen Inhalt;
  `/liga/begegnungen` und `/live/begegnungen` rendern ohnehin nur den
  404-Pfad.
- Der Service Worker fragt `/offline` weiterhin einmalig beim Install ab und
  cached Header und Body zusammen — beide tragen dann dieselbe, zu diesem
  Zeitpunkt gültige Nonce, konsistent miteinander.
- Zusätzlich zur ursprünglichen Plan-Architektur: Diese Next.js-Version
  (16.3.3) hat den Dateikonvention `middleware.ts`/`export function
  middleware` zu `proxy.ts`/`export function proxy` umbenannt und die alte
  als deprecated markiert (identisches Verhalten, siehe
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).
  Die Implementierung verwendet die neue Konvention.

## Referenzen

- `docs/superpowers/plans/2026-09-08-csp-nonce.md`
- `docs/superpowers/plans/2026-09-06-tier2-security.md:340` (ursprünglicher
  Aufschub-Grund)
