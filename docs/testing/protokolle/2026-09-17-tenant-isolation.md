# Protokoll: Tenant-Isolationsmatrix (Spec D1)

Datum: 17.09.2026. Test:
`apps/api/src/security/tenant-isolation-matrix.integration.spec.ts`, gegen
die echte, per `collectRoutes` (Task 4) gebaute Anwendung (Postgres/Redis aus
dem Worktree-`.env`). Angreifer: der `OWNER` von Organisation A, authentifiziert
per `vi.spyOn(AuthService, "getSession")`. Ziel: jede der 88 registrierten
Routen, deren Pfad `:organizationId` enthält, aufgerufen gegen Organisation B
(`fillParams` ersetzt `:organizationId` durch die ID von B, alle übrigen
Pfadparameter durch zufällige UUIDs). Erwartet wird ausschliesslich `403`
oder `404` — nie ein `2xx`-Erfolg und keine sonstige Antwort (kein `409`,
kein `500`).

## Ergebnis

**65 von 65 Tenant-Routen isoliert. Kein Sicherheitsbefund.** Der Test läuft
grün:

```
$ cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/security/tenant-isolation-matrix.integration.spec.ts

 RUN  v4.1.11 .../apps/api

 Test Files  1 passed (1)
      Tests  1 passed (1)
```

Kein Eintrag in `leaks` (kein 2xx, kein unerwarteter Statuscode), kein
Eintrag in `unproven` (kein 400/415 mehr nach Ergänzung der Körper).

## Ausgangslauf (rot) und Ursachen

Der erste Lauf mit dem Körper-Set aus dem Task-Brief scheiterte mit 20
`unproven`-Einträgen (400). Zwei Ursachen, keine davon ein
Sicherheitsbefund:

1. **Fastify lehnt einen leeren Körper mit `content-type: application/json`
   ab** (`FST_ERR_CTP_EMPTY_JSON_BODY`, Status 400). Der ursprüngliche
   Testcode aus dem Brief setzte den Header immer, auch für `DELETE`-Routen
   ohne Körper. Betraf 8 Routen (u. a. `DELETE .../players/:playerId`,
   `DELETE .../invitations/:invitationId`, `DELETE
   .../members/:userId/player`). Korrektur: der Header wird nur noch
   gesetzt, wenn tatsächlich ein Payload folgt.
2. **Fehlende Einträge in der `bodies`-Map** für 13 Routen, deren
   Zod-Schema mehr als `{}` verlangt. Aus `packages/schemas` abgeleitet und
   ergänzt:
   - `POST .../tournaments/structure-preview`
     (`tournamentStructurePreviewInputSchema`)
   - `POST .../tournaments/advanced-format-preview`
     (`advancedFormatPreviewInputSchema`, inkl. einer `stages`-Stufe)
   - `POST .../tournaments/:tournamentId/board-releases`
     (`releaseBoardSchema`)
   - `POST .../tournaments/:tournamentId/result-corrections`
     (`correctTournamentResultSchema`)
   - `POST .../tournaments/:tournamentId/withdrawals`
     (`withdrawTournamentParticipantSchema`)
   - `POST .../competitions/:competitionId/encounters`
     (`createEncounterSchema`)
   - `PATCH .../competitions/:competitionId` (`updateCompetitionSchema`,
     inkl. `commandId`/`expectedVersion`)
   - `POST .../encounters/:encounterId/doubles` (`submitDoublesSchema`)
   - `POST .../encounters/:encounterId/substitutions`
     (`substitutePlayerSchema`)
   - `POST .../encounters/:encounterId/slots/:slotId/assign`
     (`assignEncounterSlotSchema`)
   - `POST .../encounters/:encounterId/slots/:slotId/release`
     (`releaseEncounterSlotSchema`)
   - `POST .../encounters/:encounterId/slots/:slotId/walkover`
     (`declareSlotWalkoverSchema`)
   - `POST .../encounters/:encounterId/forfeit`
     (`declareEncounterForfeitSchema`)
   - `POST .../encounters/:encounterId/cancel` (`cancelEncounterSchema`)

Nach beiden Korrekturen: 0 `leaks`, 0 `unproven`, Test grün.

## Avatar-Route

`PUT .../players/:playerId/avatar` nimmt keinen JSON-Körper, sondern rohe
Bilddaten mit `content-type: image/png` entgegen (Limit 1 MB). Der Test
erkennt die Route an `key.endsWith("/avatar")` und schickt einen kleinen
PNG-Signatur-Puffer statt eines JSON-Objekts. Ergebnis: `404` (Spieler B
existiert unter A nicht) — isoliert, kein 2xx.

## Abdeckung

`routes.filter(r => r.url.includes(":organizationId"))` liefert 65 Routen
(von 88 Routen insgesamt). Die Liste wird nicht von Hand gepflegt — sie
kommt direkt aus dem Fastify-`onRoute`-Hook (`collectRoutes`, Task 4); jede
künftig neu registrierte Route mit `:organizationId` fällt automatisch unter
diesen Test.

## Nicht Teil dieses Tests

Die Matrix prüft nicht die Permission-Matrix je Rolle (Spec D2, siehe
`2026-09-17-permission-matrix.md`) und nicht das Verhalten bei
kollidierenden Namen/Slugs zwischen Organisationen (das deckt die Fachlogik
der jeweiligen Services ab).

## Nachtrag 18.09.2026 – zweiter Durchgang mit echten Ressourcen in B

Der im Abnahmeprotokoll benannte Follow-up (D1 mit tatsächlich in
Organisation B angelegten Ressourcen) ist umgesetzt. Derselbe Test enthält
jetzt zwei Durchgänge:

1. **Zufällige Kennungen** (unverändert): 403 oder 404, nie 2xx.
2. **Echte Ressourcen von B:** Ein zweiter Owner (Owner B) legt vor dem
   Durchgang über dieselben API-Routen sechs Spieler, eine Scheibe, ein
   Match, zwei Teams, ein Turnier mit Anzeigeschlüssel, einen Wettbewerb
   mit einer Begegnung (Slots entstehen mit der Begegnung) und eine
   Einladung an. `fillRealParams` ersetzt jeden Pfadparameter durch die
   echte Kennung (`:playerId`, `:matchId`, `:userId`, `:invitationId`,
   `:teamId`, `:tournamentId`, `:keyId`, `:competitionId`, `:encounterId`,
   `:slotId`); ein Parameter ohne Eintrag lässt den Test scheitern, damit
   neue Pfadparameter bewusst ergänzt werden. Erwartet wird **ausschliesslich
   403** – die Ressource existiert, der Zugriff ist fremd; ein 404 wäre
   hier ein Hinweis auf eine Route, die Existenz vor Berechtigung prüft.
   Zusätzlich wird ein Schnappschuss der Daten von B (Organisation,
   Mitgliedschaften, Spieler, Scheiben, Matches, Teams, Turniere,
   Anzeigeschlüssel, Wettbewerbe, Begegnungen, Einladungen – jeweils mit
   Status, Version und `updatedAt` – sowie die Zahl der Audit-Einträge von
   B und die Zahl der Audit-Einträge mit Owner A als Handelndem) vor und
   nach dem Durchgang verglichen.

Ergebnis: **67 von 67 Tenant-Routen antworten mit 403** (zwei Routen mehr
als am 17.09., siehe Permission-Matrix-Nachtrag: `GET` und `PATCH
/organizations/:organizationId`), der Schnappschuss ist unverändert, kein
Audit-Eintrag mit Owner A. Damit ist die Unterscheidung „nicht existent"
(404) gegen „existent, aber fremder Mandant" (403) für jede Route belegt.

```
$ cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/security/tenant-isolation-matrix.integration.spec.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)
```
