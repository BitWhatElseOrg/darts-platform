# Protokoll: Permission-Matrix (Spec D2)

Datum: 17.09.2026. Test: `apps/api/src/security/permission-matrix.integration.spec.ts`,
gegen die echte, per `createApiTestApplication` gebaute Anwendung (Postgres/Redis
aus dem Worktree-`.env`). Sechs Rollen (`OWNER`, `ADMIN`, `TOURNAMENT_DIRECTOR`,
`SCORER`, `MEMBER`, `VIEWER`) × 28 Permissions aus
`packages/domain/src/permissions.ts`. Erwartung je Paar kommt ausschliesslich
aus `hasOrganizationPermission`.

## Ergebnis

168 von 168 Paaren (6 Rollen × 28 Permissions) stimmen mit
`hasOrganizationPermission` überein. Kein Sicherheitsbefund. Der Test läuft
grün:

```
$ cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/security/permission-matrix.integration.spec.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

## `organization:update` — keine eigene Route

`grep -rn '"organization:update"' apps/api/src` findet ausser der Definition in
`packages/domain/src/permissions.ts` keine Verwendung als tatsächlich
geprüfte Permission in `apps/api/src`. Keine Route ruft
`OrganizationAccessService.requirePermission` mit
`permission: "organization:update"` auf.

Die Probe für `organization:update` teilt sich deshalb die Route
`PATCH /organizations/:id/members/:userId` mit `organization:manage_roles`
(dieselbe Route prüft dort tatsächlich `organization:manage_roles`). Das ist
zulässig, weil beide Permissions in der aktuellen Rollentabelle exakt an
denselben zwei Rollen hängen (nur `OWNER` und `ADMIN`) — die Probe liefert
für `organization:update` also weiterhin das korrekte Signal, prüft aber
technisch die Autorisierung von `organization:manage_roles`.

Befund: `organization:update` ist eine ungenutzte Permission. Falls die
Rollentabelle künftig auseinanderläuft (z. B. eine neue Rolle bekäme
`organization:manage_roles`, aber nicht `organization:update`), fiele das an
dieser Stelle nicht mehr auf. Kein Sicherheitsrisiko, aber ein
Wartungshinweis: entweder eine eigene Route/Verwendung ergänzen oder die
Permission aus `organizationPermissions` entfernen.

## `organization:read` — ebenfalls ohne eigene Prüfung

`grep -rn '"organization:read"' apps/api/src` findet dieselbe Situation:
keine Route prüft `organization:read` explizit. Die Probe nutzt
`GET /organizations/:id/players`, deren tatsächliche Prüfung
`player:read` ist. Das Ergebnis stimmt dennoch mit `hasOrganizationPermission`
überein, weil `organization:read` in der aktuellen Rollentabelle bei allen
sechs Rollen identisch zu `player:read` vergeben ist (jede Rolle, die eine der
beiden Permissions trägt, trägt auch die andere). Gleicher Wartungshinweis
wie bei `organization:update`: die Probe ist ein Platzhalter, kein
tatsächlicher Nachweis der Autorisierung dieser konkreten Permission.

## Payload-Korrekturen an den Proben

Der Ausgangstest aus dem Task-Brief scheiterte für drei Rollen (`SCORER`,
`MEMBER`, `VIEWER`) mit „erwartet 403, bekam 400" bei `tournament:create`,
`competition:manage`, `encounter:manage` und (nur `MEMBER`/`VIEWER`)
`encounter:lineup`. Ursache: die Controller validieren den Request-Body
(Zod-Schema) **vor** dem Aufruf von `OrganizationAccessService`. Ein leerer
Payload (`{}`) scheitert deshalb für jede Rolle gleich an der Validierung —
die Rechteprüfung wird nie erreicht, das Testergebnis trägt kein Signal mehr
(kein echter Sicherheitsbefund, sondern eine unbrauchbare Probe).

Korrigiert wurden die Payloads für:

- `tournament:create`: vollständiger, `createTournamentSchema`-konformer
  Rumpf (vier `participantIds`, ein `boardIds`-Eintrag, `groupCount`,
  `qualifyPerGroup`, `knockoutSize`, `seeding`). Die IDs existieren nicht,
  das führt nach der Rechteprüfung zu einem Fachfehler statt einem Erfolg —
  zulässig laut Aufgabenstellung.
- `competition:manage`: `name`, `slug` (regex-konform) und ein vollständiger
  Slot (inkl. `sequence`, das im Erstversuch fehlte und ebenfalls zu 400
  führte).
- `encounter:manage` (Route `.../start`): `commandId` und `expectedVersion`
  (`startEncounterSchema`).
- `encounter:lineup` (Route `.../nominations`): `commandId`,
  `expectedVersion`, `side` und mindestens eine Nominierung
  (`submitNominationsSchema`).

Nach der Korrektur bestehen alle sechs Rollen-Tests grün; siehe Ergebnis oben.

## Nachtrag 18.09.2026 – eigene Routen für `organization:read` und `organization:update`

Die beiden Wartungsbefunde oben sind behoben. Es gibt jetzt zwei Routen,
die genau diese Permissions prüfen:

- `GET /api/v1/organizations/:organizationId` – die eigene Organisation
  aus Sicht des Mitglieds (`OrganizationSummary` mit Rolle und
  verknüpftem Spielerprofil), geschützt durch `organization:read`.
- `PATCH /api/v1/organizations/:organizationId` – Stammdaten `name`,
  `timezone`, `locale` (`updateOrganizationSchema`, mindestens ein Feld,
  Slug bewusst nicht änderbar, weil er in öffentlichen Adressen und
  Einladungen steht), geschützt durch `organization:update`; die Änderung
  läuft transaktional mit Audit-Eintrag `ORGANIZATION_UPDATED` (alter und
  neuer Stand).

Die Proben der Matrix zeigen jetzt auf diese Routen statt auf die
Platzhalter (`GET .../players` beziehungsweise `PATCH .../members/:userId`).
Tests: `apps/api/src/organizations/organizations.integration.spec.ts`
(Lesen als OWNER und MEMBER, 403 für Nichtmitglieder, Änderung mit Audit,
403 für MEMBER ohne Schreibzugriff), `packages/schemas/src/organization.spec.ts`
(Schemagrenzen). Die Matrix bleibt 168/168 grün.

### Validierung vor Autorisierung – akzeptiert

Der dritte Befund (Zod-Validierung läuft vor `requirePermission`, eine
Rolle ohne Berechtigung bekommt bei ungültigem Rumpf 400 statt 403) wird
bewusst hingenommen und nicht umgebaut:

- Es fliessen keine Daten ab. Die Validierungsmeldungen nennen nur die
  Schemaform; die Schemas liegen in `packages/schemas` im öffentlichen
  Repository.
- Die Reihenfolge ist in allen Controllern gleich (`parseBody`, dann
  Service mit `requirePermission` als erstem Schritt). Ein Umbau hiesse
  entweder Berechtigungsprüfung in jedem der rund 40 schreibenden
  Controller vor dem Parsen oder ein Guard mit Permission-Dekoratoren an
  allen Routen – ein Architekturwechsel, dessen Regressionsrisiko bei der
  Scoring- und Turnierlogik den kosmetischen Gewinn (403 statt 400 für
  ohnehin unberechtigte Aufrufer) nicht rechtfertigt.
- Die Proben beider Matrizen tragen gültige Rümpfe; die Reihenfolge
  verfälscht damit kein Testsignal mehr.

Sollte ein zentraler Permission-Guard aus anderen Gründen eingeführt
werden, wird dieser Punkt damit automatisch erledigt.
