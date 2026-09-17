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
