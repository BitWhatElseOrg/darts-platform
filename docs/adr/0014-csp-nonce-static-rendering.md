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

Ursprünglich erhielten genau diese fünf Routen `export const dynamic =
"force-dynamic";`, damit sie bei jeder Anfrage — auch beim einmaligen
Service-Worker-Fetch von `/offline` — serverseitig mit einer frischen, zum
jeweiligen CSP-Response-Header passenden Nonce gerendert werden.

Diese Entscheidung wurde revidiert: Nachdem alle fünf Routen bereits auf
`force-dynamic` standen, war im Produktivbuild ohnehin keine einzige
HTML-Seite mehr statisch (`○`) — nur noch `/manifest.webmanifest`, ein
JSON-Dokument ohne Skripte. Damit kostet ein einziges `export const dynamic =
"force-dynamic";` im Root-Layout (`apps/web/src/app/layout.tsx`) nichts
Messbares mehr (es macht nichts statisch-Gebliebenes dynamisch, das nicht
ohnehin schon dynamisch war) und schliesst zusätzlich strukturell aus, dass
eine künftige neue Seite ohne eigene `dynamic`-Deklaration still wieder
statisch gerendert wird und ihre Nonce verliert. Die fünf ursprünglichen
Pro-Datei-Deklarationen wurden entsprechend entfernt.

Verworfene Alternativen:

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

### Verbleibende Lücke: Next.js-eigene Fallback-Seiten

Zwei weitere HTML-Dokumente im Produktivbuild tragen dasselbe Problem, sind
aber keine App-Routen und lassen sich deshalb nicht mit `export const
dynamic` beheben:

- `.next/server/app/_global-error.html` — Next.js' eingebaute
  Fallback-Seite für einen fehlgeschlagenen globalen Error Boundary. Diese
  App hat kein eigenes `apps/web/src/app/global-error.tsx`, deshalb liefert
  Next.js seine eigene, beim Build vorgerenderte Variante mit demselben
  nonce-losen `self.__next_f.push(...)`-Inline-Bootstrap.
- `.next/server/pages/500.html` — der Fallback der alten Pages Router
  „500"-Seite. Diese App nutzt ausschliesslich den App Router, aber Next.js
  legt diese Datei trotzdem als statisches Sicherheitsnetz an.

Beide werden, wie ursprünglich die fünf oben genannten Routen, beim `next
build` erzeugt — es gibt zu diesem Zeitpunkt keine Anfrage und damit keine
Nonce, und es wird auch nie eine geben: Es sind vorgebaute Next.js-interne
Artefakte, keine App-Routen, auf die `export const dynamic` (weder pro Route
noch am Root-Layout) überhaupt Einfluss hat. Ein Codefix existiert dafür
nicht.

Das greift nur, wenn das Rendern der eigenen Error-Seite der App selbst
scheitert — geprüft und bestätigt: Ein gewöhnlicher 500er (z. B. weil eine
API nicht erreichbar ist) rendert weiterhin dynamisch über die
anwendungseigene Fehlerbehandlung und bekommt dabei eine korrekte Nonce.
`_global-error.html` und `pages/500.html` sind reine Next.js-Notlösungen für
den selteneren Fall, dass selbst das Rendern der Fehlerseite fehlschlägt.

Tritt dieser Fall ein, bleibt die Seite trotzdem lesbar (Inline-Styles, keine
Abhängigkeit von Hydration für sichtbaren Inhalt), hydriert aber nicht, und
der Browser meldet für diesen einen Aufruf eine `script-src`-CSP-Verletzung
an `/api/v1/csp-reports`. Das ist hier festgehalten, damit ein künftiges,
vereinzeltes Auftauchen dieses Reports auf diesem Endpunkt nicht für einen
neuen Angriff oder Bug gehalten wird. Diese Lücke ist als bekannter,
akzeptierter Zustand dokumentiert — kein offenes Follow-up ist dafür
vorgesehen.

### Nachtrag: `'strict-dynamic'` (2026-09-08, Folgeplan)

`script-src` erlaubte bis hierher weiterhin jedes Skript von `'self'`
zusätzlich zur Nonce — eine Injektion, die einen eigenen Origin-Pfad mit
angreiferkontrolliertem Inhalt referenziert, wäre nicht blockiert worden.
`docs/superpowers/plans/2026-09-08-csp-nonce-nacharbeit.md` (Task 1) ergänzt
`'strict-dynamic'`, verifiziert per echter clientseitiger Navigation (nicht
nur vollem Seitenaufruf) gegen Bruch des Webpack-Chunk-Nachladens. Derselbe
Folgeplan setzt die Nonce zusätzlich explizit auf die Request-Header (statt
sich auf internes Next.js-Spiegelverhalten zu verlassen) und schliesst eine
separat entdeckte, unabhängige CSP-Meldequelle (Zods `eval`-Fähigkeitstest,
siehe dortiges ADR-Äquivalent im Folgeplan-Dokument selbst).

## Referenzen

- `docs/superpowers/plans/2026-09-08-csp-nonce.md`
- `docs/superpowers/plans/2026-09-06-tier2-security.md:340` (ursprünglicher
  Aufschub-Grund)
