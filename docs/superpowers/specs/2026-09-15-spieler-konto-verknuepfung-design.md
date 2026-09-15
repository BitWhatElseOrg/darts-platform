# Spieler-Konto-Verknüpfung, Team-Spalte und Listenfilter — Design

Stand 2026-09-15. Architektural eingestuft, weil die Verknüpfung entscheidet,
wessen Daten jemand als „seine eigenen" sieht, und weil sie den
Einladungspfad — den einzigen Weg zu einer Mitgliedschaft — um eine
Transaktionsstufe erweitert. Die Listenfilter allein wären bounded; sie
gehören hierher, weil sie dieselben Lesemodelle anfassen.

Verwandt: `docs/adr/0015-spieler-konto-verknuepfung.md` (Entscheid und
Alternativen), AGENTS.md §13 (Server entscheidet), §14 (Multi-Tenancy).

## Problem

`memberships` und `players` beschreiben heute zwei getrennte Welten:
Mitgliedschaft ist Zugang (Konto ↔ Organisation, Rolle, Status), Spieler ist
das sportliche Stammdatum (Matches, Teams, Statistiken). Zwischen beiden
besteht keine Beziehung — `players` hat keine `user_id`, und `players.email`
wird nirgends gegen `users.email` abgeglichen.

Menschen, die beides sind — Vereinsmitglied und Spieler —, existieren deshalb
zweimal, ohne dass das System den Zusammenhang kennt. Daraus folgen drei
konkrete Mängel:

1. Ein eingeloggter Spieler kann seine eigenen Matches und seine eigene
   Statistik nicht aufrufen. Der Server weiss nicht, welcher `player` er ist.
   Alle Spielerprofile sind reine Fremdsicht.
2. Stammdaten laufen auseinander, weil dieselbe Person an zwei Orten gepflegt
   wird.
3. Spieler- und Mitgliederliste laden vollständig und ungefiltert. Ab einigen
   Dutzend Einträgen ist die gesuchte Person nur noch durch Scrollen zu
   finden.

## Ziel

Eine optionale, ausdrückliche 1:1-Verknüpfung zwischen Konto und
Spielerprofil je Organisation, die Selbstsicht ermöglicht, ohne das
Berechtigungsmodell zu verändern — plus Suche, Filter und Team-Anzeige auf
beiden Listen.

## Nicht im Umfang

- **Zusammenlegen der beiden Begriffe.** Spieler ohne Konto bleibt der
  Normalfall (32 Turnierteilnehmer werden angelegt, nicht eingeladen), Konto
  ohne Spielerprofil ebenso (Turnierleitung, Schreiber).
- **Ressourcenbezogene Rechte.** Dass ein verknüpfter Captain die Aufstellung
  seiner eigenen Mannschaft melden darf, ist fachlich naheliegend, gibt dem
  Permission-System aber erstmals eine ressourcenbezogene Dimension. Eigener
  Entwurf, eigene Runde.
- **Selbstbeanspruchung per Claim-Code.** Bräuchte einen zweiten
  Token-Lifecycle mit Ablauf, Widerruf und Audit. Verworfen, solange die
  Leitung die Zuordnung übernehmen kann.
- **Ein eigenes Vereins- oder Clubfeld auf `players`.** Verworfen zugunsten
  der bestehenden `team_players`-Historie, siehe „Entscheide".
- **Serverseitige Suche und Paginierung.** Siehe „Entscheide".
- **Automatische Zuordnung bestehender Mitglieder über E-Mail-Gleichheit.**
  `players.email` ist kaum gepflegt und nicht eindeutig; eine stille
  Fehlzuordnung wiegt schwerer als der gesparte Handgriff.

## Bestand (geprüft 2026-09-15)

- `packages/database/src/schema.ts:136-207` — `memberships`
  (`UNIQUE (organization_id, user_id)`, Rolle, Status) und `players`
  (`public_id`, `status ACTIVE|INACTIVE`, keine `user_id`).
- `apps/api/src/organizations/organizations.repository.ts:329` —
  `acceptInvitation` sperrt die Einladung `for update`, liest die bestehende
  Mitgliedschaft unter der Sperre und schreibt Mitgliedschaft und
  Audit-Eintrag in einer Transaktion. Sperrreihenfolge Einladung →
  Mitgliedschaft.
- `packages/domain/src/permissions.ts:82-103` — `MEMBER` und `VIEWER` haben
  bereits `player:read`, `statistics:read`, `team:read`.
- `apps/api/src/statistics/statistics.controller.ts:7` —
  `GET /organizations/:organizationId/players/:playerId/statistics` existiert.
- `apps/api/src/teams/teams.repository.ts:275` und
  `packages/schemas/src/league.ts:41-58` — `GET …/teams` liefert je Team die
  Mitglieder mit `role` und `validTo`.
- `apps/api/src/players/players.repository.ts:26` — `list` liefert die
  vollständige, nach `display_name` sortierte Liste ohne Filter. Dieselbe
  Abfrage füttert die Turnier-Teilnehmerauswahl.
- `apps/web/src/components/players/roster-route.tsx` — 302 Zeilen, trägt
  Spielerliste, Spielerformular und Einladungsformular in einer Datei.
- `apps/web/src/components/organization/members-route.tsx` — 313 Zeilen.
- Letzte Migration: `packages/database/drizzle/0029_…`.

## Entscheide

**E1 — Verknüpfung als nullable `players.user_id`, nicht als Feld auf der
Mitgliedschaft.** Der Spieler ist das langlebigere Objekt: er überlebt das
Konto, trägt die Matchhistorie und existiert auch ohne Zugang. Die
Mitgliedschaft ist der flüchtigere Teil.

**E2 — Kein eigenes Vereins- oder Clubfeld.** Die Organisation ist im
Datenmodell bereits der Verein, und die Zugehörigkeit zu einer Mannschaft
führt `team_players` samt Gültigkeitszeitraum und Captain-Rolle. Ein
Freitextfeld daneben erzeugt Tippvarianten („DC Musterstadt" gegen „Dartclub
Musterstadt"), die Filter und spätere Auswertungen still zerstören. Die Liste
zeigt und filtert die aktive Zugehörigkeit aus `team_players`.

**E3 — Suche und Filter im Browser.** Die Liste wird ohnehin vollständig
geladen; clientseitiges Filtern reagiert ohne Verzögerung, ändert keinen
API-Vertrag und schafft keine neue Tenant-Fläche. Das trägt bis in den
niedrigen vierstelligen Bereich. Danach ist nicht die Suche das Problem,
sondern die Übertragungsgrösse — dann sind serverseitige Filter *und*
Paginierung fällig, und zwar gemeinsam mit der Turnier-Teilnehmerauswahl, die
an derselben Abfrage hängt.

**E4 — Zwei Wege zur Verknüpfung.** Der Einladungspfad deckt Neuzugänge ohne
Nachpflege ab; die manuelle Zuordnung deckt den heutigen Bestand, Korrekturen
und Fehleingaben ab. Ohne den zweiten Weg bliebe das Feature für jedes
bestehende Konto wirkungslos.

**E5 — `hasAccount` statt `userId` im Spieler-Lesemodell.** `player:read`
haben auch `MEMBER` und `VIEWER`. Über die Spielerliste sollen keine
Kontoadressen abfliessen, die heute hinter `organization:manage_members`
liegen.

## Datenmodell

Migration `0030_player_account_link.sql`:

```sql
alter table players
  add column user_id uuid references users(id) on delete set null;

create unique index players_organization_user_unique
  on players (organization_id, user_id)
  where user_id is not null;

alter table organization_invitations
  add column player_id uuid references players(id) on delete set null;
```

- `on delete set null` bei `players.user_id`: ein gelöschtes Konto darf kein
  Spielerprofil mitreissen — daran hängen Matches, Legs und Statistiken. Die
  Person bleibt als Spieler bestehen, nur der Zugang verschwindet.
- Der partielle Unique-Index erzwingt die 1:1-Beziehung je Organisation als
  DB-Constraint; beliebig viele Spieler bleiben kontolos.
- `organization_invitations.player_id` bleibt nullable: Einladen ohne
  Spielerbezug ist der Normalfall.
- Bestandsdaten sind nach der Migration unverändert, `user_id` ist überall
  null.

Eine Invariante lässt sich hier nicht als Constraint ausdrücken: der
verknüpfte Spieler muss zur selben Organisation gehören wie Einladung und
Mitgliedschaft. Ein Check dafür bräuchte einen zusammengesetzten
Fremdschlüssel über zwei Spalten. Sie wird in jeder schreibenden Transaktion
geprüft und durch Integrationstests abgesichert.

## API

### Einladung mit Spielerbezug

`createInvitationSchema` erhält ein optionales `playerId: z.uuid()`.

Beim Erstellen prüft der Service unter der Organisationssperre: der Spieler
existiert, gehört zu dieser Organisation, hat `status = ACTIVE` und ist noch
mit keinem Konto verknüpft. Sonst 422 `PLAYER_NOT_ASSIGNABLE`.

Beim Annehmen entstehen Mitgliedschaft und Verknüpfung in einer Transaktion.
Sperrreihenfolge Einladung → Mitgliedschaft → Spieler, also dieselbe Richtung
wie bisher, um die vorhandene Ordnung gegen `updateMembership` (Organisation →
Mitgliedschaft) nicht zu brechen.

Zwischen Einladen und Annehmen liegen Tage. Die Konfliktfälle:

| Lage bei der Annahme | Verhalten |
|---|---|
| Spieler mit **diesem** Konto verknüpft | idempotent, Annahme läuft durch |
| Spieler mit **anderem** Konto verknüpft | 409 `PLAYER_ALREADY_LINKED`, Einladung bleibt `PENDING` |
| Konto bereits mit anderem Spieler dieser Organisation verknüpft | 409 `PLAYER_ALREADY_LINKED`, Einladung bleibt `PENDING` |
| Spieler gelöscht (`player_id` inzwischen null) | Annahme läuft ohne Verknüpfung durch |
| Spieler inzwischen `INACTIVE` | 409 `PLAYER_ALREADY_LINKED` ist falsch; 409 `PLAYER_NOT_ASSIGNABLE`, Einladung bleibt `PENDING` |

Die offen bleibende Einladung folgt dem Muster von `MEMBERSHIP_SUSPENDED`: die
Leitung räumt auf, derselbe Claim-Token gilt weiter. Stilles Überspringen wäre
der gefährliche Weg — jemand bekäme eine fremde Identität oder gar keine, ohne
dass es auffällt.

### Manuelle Zuordnung

```text
PUT    /api/v1/organizations/:organizationId/members/:userId/player   { playerId }
DELETE /api/v1/organizations/:organizationId/members/:userId/player
```

Eigene, schmale Ressource statt eines weiteren Feldes in
`PATCH …/members/:userId`, dessen Transaktion bereits Eigentumsregeln und den
Schutz des letzten aktiven OWNER trägt.

- Berechtigung: `organization:manage_members`.
- Transaktional, Sperrreihenfolge Organisation → Mitgliedschaft → Spieler.
- `PUT` verlangt eine bestehende Mitgliedschaft (jeder Status) und einen
  aktiven, freien Spieler derselben Organisation; ein bereits an ein anderes
  Konto vergebener Spieler ergibt 409 `PLAYER_ALREADY_LINKED`, eine bestehende
  Zuordnung desselben Kontos auf einen anderen Spieler wird ersetzt.
- `DELETE` ist idempotent: keine Zuordnung vorhanden ergibt 204.
- Audit: `PLAYER_LINKED` / `PLAYER_UNLINKED` mit Organisation, Zielkonto,
  Spieler und handelnder Person.

### Lesemodelle

- `organizationSummarySchema` += `playerId: uuid | null` — beantwortet
  „welcher Spieler bin ich" ohne neuen Endpunkt.
- `organizationMemberSchema` += `player: { id, displayName } | null` — nur auf
  einem Endpunkt, der ohnehin `organization:manage_members` verlangt.
- `playerSchema` += `hasAccount: boolean` — bewusst ohne `userId` und ohne
  E-Mail, siehe E5.

Damit braucht die Selbstsicht keinen neuen Endpunkt: Profilseite und
Statistik-Endpunkt existieren, `MEMBER` darf sie lesen, es fehlte nur die
eigene ID.

## Weboberfläche

### Suche und Filter

Eine gemeinsame Filterleiste über beiden Listen:

| | Spielerliste | Mitgliederliste |
|---|---|---|
| Suche über | Anzeigename, Vorname, Nachname, Spitzname | Anzeigename, E-Mail |
| Filter | Status, Team, Konto (mit / ohne) | Rolle, Status, Spielerzuordnung |

Der Vergleich läuft akzentunempfindlich: `normalize("NFD")`, kombinierende
Zeichen entfernt, `toLocaleLowerCase("de-CH")`. Sonst findet „Muller" kein
„Müller" und „Jerome" kein „Jérôme" — bei Schweizer Namen fällt das sofort
auf.

Normalisierung und Filterprädikate sind reine Funktionen in
`apps/web/src/lib/`, nicht in der Komponente (AGENTS.md §4: keine
Business-Logik in React-Komponenten). Damit sind sie direkt testbar.

Bedienung: Trefferzahl als `aria-live`-Region („12 von 87 Spielern"),
Leerzustand mit „Filter zurücksetzen", Eingabefelder auf der bestehenden
`min-h-11`-Konvention, Filterzustand als lokaler Komponentenstate. Teilbare
Filter-Links löst heute niemand ein, deshalb nicht in die URL.

### Team-Spalte

Aus den aktiven Zugehörigkeiten (`validTo === null`) von `GET …/teams`.
Mehrere Teams werden aufgezählt, die Captain-Rolle bekommt ein Textkürzel —
keine Information ausschliesslich über Farbe (AGENTS.md §19).

### Verknüpfung

- Mitgliederzeile: „Spieler zuordnen" mit durchsuchbarer Auswahl (nur aktive,
  freie Spieler) und „Zuordnung lösen" mit Rückfrage. Sichtbar nur bei
  `organization:manage_members` — als Bedienhilfe; die Guards bleiben die
  Sicherheitsgrenze.
- Einladungsformular: optionales Feld „Spielerprofil".
- `WorkspaceShell`: Einstieg „Mein Profil", wenn `organization.playerId`
  gesetzt ist.

### Gezielter Umbau

`roster-route.tsx` (302 Zeilen) trägt bereits drei Zuständigkeiten. Mit
Filterleiste, Team-Spalte und Spielerauswahl wüchse sie auf ein Vielfaches.
Sie wird beim Anfassen in Liste, Formulare und Filterleiste zerlegt. Kein
Umbau an unbeteiligten Stellen.

## Tests

- **Unit (web):** Normalisierung und Filterprädikate — Umlaute und Akzente,
  leere Suche, Kombination mehrerer Filter, Spieler ohne Team.
- **Integration (api):** Tenant-Isolation der neuen Endpunkte; Einladung mit
  organisationsfremder oder inaktiver `playerId` wird abgelehnt; alle fünf
  Annahme-Konfliktfälle; Unique-Verletzung ergibt 409, nicht 500; `DELETE`
  ist idempotent; Audit-Einträge entstehen; `hasAccount` gibt keine E-Mail
  preis; `organizationSummary.playerId` zeigt nur den eigenen Spieler.
- **Render (web):** Mitgliederzeile mit und ohne Zuordnung, Leerzustand der
  Filter.
- **Migration:** Bestandsdaten unverändert, `user_id` überall null.

## Risiken

- **Falsche Zuordnung durch die Leitung.** Eine Person sähe fremde
  Statistiken als ihre eigenen. Gegenmittel: Auswahl zeigt nur freie aktive
  Spieler, jede Zuordnung ist auditiert und jederzeit lösbar. Ein
  Bestätigungsschritt beim Lösen verhindert das versehentliche Kappen.
- **Wachsende Listengrösse.** E3 trägt nicht unbegrenzt. Sichtbar wird das an
  der Ladezeit der Liste, nicht am Filtern; der Auslöser für serverseitige
  Filter und Paginierung ist die Übertragungsgrösse.
- **Verknüpfung als stille Rechteerweiterung.** In dieser Runde nicht: die
  Verknüpfung gewährt keine Berechtigung, sie beantwortet nur eine Identität.
  Sobald ressourcenbezogene Rechte darauf aufbauen, wird sie
  sicherheitsrelevant — das gehört dann in den Entwurf jener Runde.
