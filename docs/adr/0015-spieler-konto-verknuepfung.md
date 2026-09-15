# ADR 0015: Konto und Spieler bleiben getrennt und werden optional verknüpft

**Status:** Accepted
**Datum:** 15. September 2026

## Kontext

Das Datenmodell führt zwei Begriffe, die dieselbe Person meinen können, aber
verschiedene Fragen beantworten:

- `memberships` verbindet ein Konto (`users`) mit einer Organisation und trägt
  Rolle und Status. Sie beantwortet: *wer darf was bedienen?*
- `players` ist das sportliche Stammdatum einer Organisation. Daran hängen
  `match_participant_players`, `tournament_participants`, `team_players` und
  `player_statistic_aggregates`. Sie beantwortet: *wer kommt im Spielbetrieb
  vor?*

Zwischen beiden bestand keine Beziehung. `players` hat keine `user_id`, und
`players.email` ist ein freies Stammdatum ohne Unique-Constraint, das nirgends
gegen `users.email` abgeglichen wird.

Beide Richtungen sind gewollte Normalfälle und dürfen nicht verschwinden: bei
einem offenen Turnier werden 32 Teilnehmer angelegt und niemand eingeladen;
umgekehrt bedienen Turnierleitung und Schreiber das System, ohne selbst zu
spielen.

Der fehlende Zusammenhang kostet aber dort, wo beides zusammenfällt — beim
spielenden Vereinsmitglied. Der Server kann die Frage „welcher Spieler bin
ich?" nicht beantworten, also gibt es keine Selbstsicht auf eigene Matches und
eigene Statistik, obwohl `MEMBER` und `VIEWER` mit `player:read` und
`statistics:read` längst die Rechte dafür haben und
`GET /organizations/:organizationId/players/:playerId/statistics` existiert.
Es fehlte allein die Identität.

## Entscheidung

Konto und Spieler bleiben getrennte Entitäten. Sie werden **optional** und
**höchstens 1:1 je Organisation** verknüpft, über eine nullable
`players.user_id` mit partiellem Unique-Index
`(organization_id, user_id) where user_id is not null`.

Begründungen im Einzelnen:

**Die Verknüpfung liegt auf dem Spieler, nicht auf der Mitgliedschaft.** Der
Spieler ist das langlebigere Objekt: er trägt die Matchhistorie, existiert
ohne Zugang und überlebt das Konto. Deshalb `on delete set null` — ein
gelöschtes Konto darf kein Spielerprofil mitreissen, an dem Matches, Legs und
Statistiken hängen. Die Person bleibt als Spieler bestehen, nur der Zugang
verschwindet.

**Die Verknüpfung entsteht auf zwei Wegen.** Beim Einladen kann optional ein
bestehender Spieler mitgegeben werden (`organization_invitations.player_id`);
Mitgliedschaft und Verknüpfung entstehen dann beim Annehmen in einer
Transaktion. Daneben gibt es eine manuelle Zuordnung über
`PUT`/`DELETE /organizations/:organizationId/members/:userId/player` mit
`organization:manage_members`. Ohne den zweiten Weg bliebe das Merkmal für
jedes heute bestehende Konto wirkungslos, weil alle Mitgliedschaften bereits
existieren.

**Die Verknüpfung gewährt keine Berechtigung.** Sie beantwortet eine
Identität, mehr nicht. Autorisiert wird weiterhin ausschliesslich über Rolle
und Permission (AGENTS.md §13). Damit bleibt die Angriffsfläche dieser Runde
klein, und das Merkmal ist keine Vorbedingung für Sicherheitsaussagen.

**Das Spieler-Lesemodell zeigt `hasAccount`, nicht `userId`.** `player:read`
haben auch `MEMBER` und `VIEWER`. Über die Spielerliste sollen keine
Kontoadressen abfliessen, die heute hinter `organization:manage_members`
liegen.

### Verworfene Alternativen

**Verschmelzen zu einer Entität.** Würde entweder für jeden Turnierteilnehmer
ein Konto erzwingen — undurchführbar bei offenen Turnieren — oder jedem
Schreiber ein Spielerprofil aufdrängen, das in Ranglisten und Statistiken
auftaucht.

**Zuordnung über E-Mail-Gleichheit.** `players.email` ist optional, kaum
gepflegt und nicht eindeutig. Eine automatische Zuordnung träfe fast niemanden
und könnte zugleich falsch zuordnen — eine stille Fehlzuordnung wiegt
schwerer als der gesparte Handgriff.

**Selbstbeanspruchung per Claim-Code.** Entlastet die Leitung, verlangt aber
einen zweiten Token-Lifecycle mit Ablauf, Widerruf und Audit neben dem
Einladungspfad. Verworfen, solange die Leitung die Zuordnung übernehmen kann.

**Ein eigenes Vereins- oder Clubfeld auf `players`.** Die Organisation ist im
Datenmodell bereits der Verein, und die Mannschaftszugehörigkeit führt
`team_players` samt Gültigkeitszeitraum und Captain-Rolle. Ein Freitextfeld
daneben erzeugt Tippvarianten, die Filter und spätere Auswertungen still
zerstören.

## Konsequenzen

- Der Einladungspfad — bisher der einzige Weg zu einer Mitgliedschaft —
  bekommt eine Stufe mehr in derselben Transaktion. Die Sperrreihenfolge
  bleibt Einladung → Mitgliedschaft → Spieler und kreuzt sich damit nicht mit
  `updateMembership` (Organisation → Mitgliedschaft).
- Zwischen Einladen und Annehmen liegen Tage, in denen der vorgemerkte Spieler
  anderweitig verknüpft, archiviert oder gelöscht werden kann. Diese Fälle
  enden in 409 mit offen bleibender Einladung statt in stillem Überspringen:
  wer eine fremde Identität oder gar keine bekommt, soll es merken. Die
  Einzelfälle stehen in der Spec.
- Die Selbstsicht („Mein Profil", eigene Statistik) entsteht ohne neuen
  Endpunkt und ohne neue Permission — `organizationSummary.playerId` genügt.
- Eine falsche Zuordnung durch die Leitung würde fremde Statistiken als eigene
  zeigen. Gegenmittel: die Auswahl bietet nur freie, aktive Spieler, jede
  Zuordnung ist auditiert (`PLAYER_LINKED` / `PLAYER_UNLINKED`) und jederzeit
  lösbar.
- Sobald ressourcenbezogene Rechte auf der Verknüpfung aufbauen — etwa „ein
  verknüpfter Captain darf die Aufstellung seiner eigenen Mannschaft melden"
  —, wird sie sicherheitsrelevant. Das ist bewusst nicht Teil dieser Runde und
  braucht einen eigenen Entwurf.

## Referenzen

- `docs/superpowers/specs/2026-09-15-spieler-konto-verknuepfung-design.md`
- ADR 0002 (Identity und Tenancy), ADR 0010 (Invite-only-Registrierung)
- AGENTS.md §13 (Auth und Authorization), §14 (Multi-Tenancy)
