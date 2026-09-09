# Tier-3-Backlog und Rückfragen (Stand 2026-09-08)

Kein Implementierungsplan im Sinne von `superpowers:writing-plans` — diese Punkte
sind entweder Business-Entscheide, brauchen erst eine eigene Spec, oder sind
reine Konfigurations-/Kostenentscheide ausserhalb von Code. Für alles, was
direkt umsetzbar war, siehe die drei Geschwister-Pläne vom selben Tag:

- `2026-09-08-anzeige-schluessel-nacharbeiten.md`
- `2026-09-08-team-encounter-datenintegritaet.md`
- `2026-09-08-csp-nonce.md`

## CSP-Nonce — Nacharbeit aus dem Abschlussreview (2026-09-08) — erledigt

Der Plan `2026-09-08-csp-nonce.md` ist umgesetzt und gemergt (siehe ADR 0014).
Das Abschlussreview hatte drei nicht-blockierende Punkte hinterlassen, die
bewusst nicht in denselben Branch gehörten — alle drei sind jetzt über den
Folgeplan `2026-09-08-csp-nonce-nacharbeit.md` umgesetzt (Branch
`worktree-csp-nonce-nacharbeit`, gestapelt auf `feature/csp-nonce`/PR #33, da
`develop` `proxy.ts` zum Zeitpunkt dieser Nacharbeit noch nicht enthielt):

- ~~**`'strict-dynamic'` ergänzen.**~~ Erledigt. Verifiziert per echter
  clientseitiger Navigation (Klick, nicht `page.goto`) plus Isolations-Check
  (Git-Stash), dass Webpack-Chunk-Nachladen weiterhin funktioniert — kein
  Verstoss dem `'strict-dynamic'` zurechenbar.
- ~~**CSP zusätzlich auf die Request-Header setzen.**~~ Erledigt —
  `apps/web/src/proxy.ts` setzt die Nonce jetzt sowohl auf Request- als auch
  Response-Header, unabhängig vom internen Next.js-Spiegelverhalten.
- ~~**E2E-Fall gegen den echten Produktivbuild.**~~ Erledigt — neue,
  dauerhafte Testinfrastruktur (`playwright.prod.config.ts`,
  `tests/production-csp.spec.ts`, Skript `test:e2e:prod`), bewusst nicht
  Teil von `pnpm test:e2e`/CI (Kostenentscheid). Deckt jetzt auch die beiden
  waehrend dieser Nacharbeit gefundenen, zusaetzlichen Probleme
  (`'strict-dynamic'`, `jitless`) gegen den echten Produktivbuild ab.
- ~~**`jitless`-Platzierung nur empirisch, nicht garantiert robust — bleibt offen.**~~
  Erledigt — `docs/superpowers/plans/2026-09-09-zod-jitless-instrumentation-client.md`
  verankert den Aufruf stattdessen in `apps/web/src/instrumentation-client.ts`,
  Next.js' eigenem, framework-garantiert vor jeder Hydration ausgeführtem
  Bootstrap-Hook, statt sich auf Webpack-Bundling-Zufall zu verlassen. Zod v4
  prüft beim ersten Schema-Zugriff pro Bundle-Kopie einmalig per
  `Function("")`, ob JIT-Kompilierung möglich ist — unter der erzwungenen
  CSP schlägt das fehl und meldet einen echten `script-src`-`eval`-Verstoss.
  `z.config({ jitless: true })` in `providers.tsx` (Commit `257bd22`)
  vermeidet das zuverlässig in allen bisherigen Tests (0/5 über zwei
  unabhängige Testläufe), aber nur, weil Webpack diesen einzeln genutzten
  Aufruf heute in den früh geladenen Layout-Chunk inlined. Ein Versuch, den
  Aufruf stattdessen nach `environment.ts` zu verschieben (erreichbar über
  mehrere Importer: `auth-client.ts`, `api-client.ts`, `realtime.ts`,
  `health.ts`, `live-address.ts`), erzeugte reproduzierbar (3/3) einen neuen
  Verstoss aus einer dritten, separat geladenen Zod-Bundle-Kopie — weil
  Next.js Chunk-Skripte als `async` ausliefert und zwischen getrennt
  geladenen Chunks keine Ausführungsreihenfolge garantiert. Die aktuelle
  Lösung ist damit ein Bundling-Zufall, kein vertraglich zugesichertes
  Verhalten. Eine wirklich robuste Lösung bräuchte entweder ein synchrones,
  nonce-versehenes Inline-`<script>` im `<head>` des Root-Layouts (das
  `globalThis.__zod_globalConfig` direkt setzt, vor jedem async geladenen
  Chunk) oder eine Next.js-/Webpack-Konfigurationsänderung, die diesen
  Aufruf in einen garantiert zuerst ausgeführten Chunk zwingt — beides
  ausserhalb des Rahmens einer kleinen Konfigurationsaufgabe und laut
  AGENTS.md §6/§26 eine eigene Spec/ADR wert. `pnpm --filter
  @darts-platform/web test:e2e:prod` (Route `/`) wuerde eine solche
  Regression auffangen, statt sie nur in dieser Notiz dokumentiert zu lassen.

## Bereits erledigt, aber noch in älteren Memory-Notizen als offen geführt

Bei der Recherche für diesen Plan stellte sich heraus, dass zwei Punkte aus
`audit-offene-punkte` bereits gebaut sind, aber nicht aus der Notiz entfernt
wurden:

- **Mitgliedschaftsänderungen ohne UI** — es gibt bereits eine vollständige
  Oberfläche: `apps/web/src/components/organization/members-route.tsx`
  (Rollen-Select, Deaktivieren/Reaktivieren, `OwnerTransferDialog`).
- **Anwurf-Entscheid (Reglement 2.2.9) ohne Web-Aufrufer** — es gibt bereits
  `apps/web/src/components/match/leg-decision-dialog.tsx`, verdrahtet über
  `use-match-scoring.ts:329` auf `POST …/matches/:id/leg-start` bzw.
  `leg-by-bull`. Vermutlich durch PR #21 ("Anwurf/Ausbullen im Scoreboard")
  gebaut, ohne die ältere Notiz in `audit-offene-punkte.md` zu bereinigen.

**Empfehlung:** Beide Punkte aus der Memory als erledigt markieren (Nachfolge
dieses Plans). Kein Code-Task nötig.

## Braucht eine Rückfrage, bevor irgendetwas geplant wird

**A1/A4/A5 als Audit-Befunde: nicht auffindbar.** Die Recherche fand kein
Audit-Dokument, das Befunde unter diesen Codes führt — die eigenständigen
Audit-Originale (`.../scratchpad/audit/A-architektur.md` etc.) existieren
nicht mehr im Dateisystem, nur Zitate daraus in den Tier-2-Plänen. Was unter
"A1", "A4", "A5" tatsächlich existiert, sind Reglement-Abschnitte in
`LIGA-REGLEMENT.md:266-395` (A1 Ligatabelle/Einzelrangliste, A4 Sanktionen,
A5 Nationalliga) — ein anderes Nummerierungssystem. Bitte klären: war mit
"A1/A4/A5" wirklich ein Audit-Befund gemeint (dann bräuchte es zuerst eine
Rekonstruktion aus den Tier-2-Plan-Zitaten) oder die Reglement-Abschnitte
(dann sind das die schon bekannten, bewusst nicht-im-Umfang-Punkte der
Team-Encounter-Spec, siehe unten)?

## Braucht erst eine eigene Spec (kein Task ohne weitere Scoping-Runde)

Die folgenden Tier-3-Punkte stehen nur als Kurzverweis in bereits umgesetzten
Tier-2-Plänen (`docs/superpowers/plans/2026-09-06-tier2-*.md`,
`2026-09-07-realtime-kanal-autorisierung.md:543`). Die vollständigen
Original-Audit-Texte existieren nicht mehr; die Zitate reichen nicht für
TDD-Tasks ohne Platzhalter.

- **I-7 — zusammengesetzte Tenant-Fremdschlüssel.** Ziel: DB-seitig
  erzwingen, dass eine referenzierte Zeile (z. B. `encounter_slots.match_id`
  → `matches.id`) tatsächlich zur selben `organization_id` gehört, nicht nur
  über Applikationslogik. Braucht zuerst eine Bestandsaufnahme, welche
  Fremdschlüssel im Schema betroffen sind, dann eine Migrationsstrategie
  (Composite Foreign Keys in Postgres brauchen einen zusammengesetzten
  Unique-Index auf der Zieltabelle).
- **C10 / I10 — Snapshot und `payload_version`, Abgleichlauf.** Ziel laut
  Zitat: ein Mechanismus, der erkennt, wenn eine Realtime-Payload gegenüber
  dem aktuellen Datenbankstand veraltet ist, plus ein Abgleichlauf. Braucht
  ein Design für `payload_version` (pro Aggregat? pro Ereignistyp?) und wie
  der Abgleichlauf mit dem bestehenden Outbox-Relay zusammenspielt.
- **E-I2/I3/I4 — Design-System-Konsolidierung.** Zwei Button-Primitiven
  vereinheitlichen, React Hook Form in die League-Panels bringen, die
  siebenfache `inputClassName`-Wiederholung auflösen. Braucht zuerst eine
  Design-Entscheidung (welche der beiden Button-Varianten bleibt?), dann erst
  eine Migrationsliste der betroffenen Komponenten.
- **G-I7 — breiterer DOM-Testausbau.** Ziel unklar genug, dass eine Spec vor
  jeder Umsetzung zuerst festlegen müsste, welche Flächen gemeint sind.

## Reine Konfigurations-/Kostenentscheide (kein Code-Plan)

- **G-I3 — Required Status Checks (Branch Protection).** Geprüft: GitHub
  meldet `403 Upgrade to GitHub Pro or make this repository public` für
  Branch-Protection-Regeln auf einem privaten Repo im aktuellen Plan. Bleibt
  blockiert, bis das Repo öffentlich wird oder ein GitHub-Pro-Plan gebucht
  ist — keine Code-Aufgabe.
- **G-I5 — CI-Ressourcen für E2E.** Reiner Kostenentscheid (mehr/teurere
  GitHub-Actions-Runner für parallele E2E-Läufe), keine Implementierung.

## Sporadisch rote Tests — Empfehlung: nur beobachten, kein Fix-Task

Beide bereits gemeldeten Fälle sind bei genauerem Hinsehen keine offenen
Bugs mehr:

- `team-encounter.spec.ts` — die tatsächliche Assertion (Zeile 185, nicht wie
  in der Memory vermerkt Zeile 256) trägt bereits einen ausführlichen
  Begründungskommentar und ein `.poll(...)`-Wartemuster mit 30s-Timeout —
  sieht nach einer bereits vorgenommenen Stabilisierung aus.
- `prune-outbox.integration.spec.ts` — die tolerante Assertion
  (`toBeGreaterThanOrEqual(2)`) ist bewusst so kommentiert: gemeinsame
  Dev-Datenbank, Rückstand durch andere Prozesse nicht kontrollierbar. Das ist
  eine akzeptierte Design-Entscheidung, kein Fehler.

**Empfehlung:** Beide Punkte aus `audit-offene-punkte.md` streichen oder auf
"nur beobachten" herabstufen, statt als offene Aufgabe zu führen.

## Team-Encounter — Business-Entscheide für die Turnierleitung (kein Code)

Aus `docs/superpowers/specs/2026-09-02-team-encounter-league-design.md:1151-1174`,
unverändert offen:

1. Welche Spielklasse gilt (bestimmt `out_rule`/`in_rule` der Vorlage)?
2. Greift die Rundenbegrenzung (20 Runden + Ausbullen) in der tatsächlich
   gespielten Gruppe, oder ist das eine Steeldart-Gruppe ohne Automatenlimit?
3. Kaderstichtag: gegen Ansetzungszeitpunkt der Begegnung oder ein fester
   Stichtag?
4. Aushilfenkontingente (1.2.3/1.2.4/1.2.9) — bleiben vorerst
   Turnierleitungs-Verantwortung, nicht Code-geprüft.
5. Spieltag/Datum-Modell bestätigen (mehrere Kalendertage pro Runde, ein
   spielfreies Team bei neun Teams).

Keiner blockiert Code — das sind Wettbewerbseinstellungen, keine
Implementierungsentscheidungen.

## Team-Encounter — bewusst "nicht im Umfang" (Season-Spec, nicht jetzt)

Wörtlich aus derselben Spec, Zeilen 1101-1117: Saison/Divisionen/
Spielplangenerierung, Ligatabelle (A1.5) und Einzelrangliste (A1.7-A1.9,
Rohdaten liegen aber schon auf `encounters`), Auf-/Abstieg, Lizenzen,
Saisonkontingente, Spielverschiebung als Vorgang, Bussen/Sperren/Protest,
Liga-Finale/Teamcup, Captain-Self-Service, Doppelstatistik-Auswertung,
nachträgliche Ergebniskorrektur, Turnierserien, Teams in Turnieren.

Der dritte der drei Constraint-Nachträge (normalisierte
Begegnung-Mannschaft-Beziehung + Spielplangenerierung, siehe
`2026-09-08-team-encounter-datenintegritaet.md`) gehört fachlich hierher —
braucht die Season-Spec, bevor eine Migration sinnvoll ist.

## Team-Encounter — sonstige Nacharbeit ausserhalb der Roadmap

- Impeccable-Audit der Begegnungsleitung (keine `.impeccable/surfaces`-Datei
  vorhanden).
- Durchgang mit der Turnierleitung am deployten Stand — organisatorisch, kein
  Code.

**Why:** Diese Notiz trennt bewusst "sofort als Plan umsetzbar" (die drei
Geschwister-Pläne) von "braucht zuerst eine Entscheidung oder eine neue
Spec" — ein TDD-Plan mit geratenen Platzhaltern für z. B. I-7 oder C10 wäre
laut `superpowers:writing-plans` ein Planfehler, kein Zeitgewinn.

**How to apply:** Vor der nächsten Runde an einem dieser Punkte zuerst die
fehlende Spec schreiben (`superpowers:brainstorming` → `superpowers:writing-plans`),
nicht direkt implementieren.
