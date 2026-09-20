# E-Mail-Versand: Einladung und Passwort-Reset — Design

Stand 2026-09-20. Architektural eingestuft, weil das Feature eine Fähigkeit
einführt, die es im System noch nicht gibt: ausgehende E-Mails. Heute kennt
die Plattform keinen Mail-Provider, keine Versandschicht und keine
Mail-Konfiguration. Better Auth läuft ohne Passwort-Reset und ohne
Verifikation.

Verwandt: AGENTS.md §4 (Business-Logik in Paketen, Realtime erst nach Commit),
§10 (transaktionale Abläufe mit Outbox und Audit), §11 (Idempotency), §13
(Server entscheidet), §14 (Multi-Tenancy), §17 (Ports/Adapter), §18 (kein
versteckter Datenverlust); `docs/adr/0010-invite-only-registration.md`
(Einladungscode, Hash in der Datenbank, Claim beim Annehmen);
`packages/database/src/outbox.ts` (Retry, Backoff, Dead-Letter);
`apps/worker/src/statistics/process-statistics-outbox.ts` (Poller-Muster).

## Problem

Eine Einladung erzeugt heute einen Code, der einmalig in der Oberfläche
erscheint. Die einladende Person muss ihn von Hand weitergeben, die
eingeladene Person muss ihn zusammen mit exakt derselben E-Mail-Adresse
abtippen. Das ist der häufigste Stolperstein beim Aufnehmen neuer Mitglieder.

Ein vergessenes Passwort lässt sich nicht zurücksetzen. Der einzige Weg ist
ein Eingriff in der Datenbank.

## Ziel

Die eingeladene Person erhält eine Mail mit einem Link, der die Registrierung
mit vorbelegter Adresse und Code öffnet. Die einladende Person sieht, ob die
Mail versendet wurde, und kann sie erneut auslösen. Wer sein Passwort
vergisst, setzt es über einen Mail-Link selbst zurück.

Beides läuft über einen einzigen Versandweg, der Provider-Ausfälle überlebt,
keine Doppelzustellung erzeugt und Fehler sichtbar macht.

## Nicht im Umfang

- Keine E-Mail-Verifikation bei der Registrierung. Die Adresse ist durch die
  Einladung bereits bestätigt.
- Keine Benachrichtigungen zu Turnieren, Begegnungen oder Ergebnissen. Der
  Versandweg ist dafür ausgelegt, die Anwendungsfälle sind eigene Features.
- Keine Mail-Vorlagenverwaltung in der Oberfläche. Templates sind Code.
- Kein Empfang von Mails, keine Bounce-Webhooks. Dead-Letter und
  Fehlerzustand in der Liste decken den ersten Betrieb ab.
- Keine Mehrsprachigkeit. Deutsch in Schweizer Rechtschreibung.

## Entscheidungen

### Versandweg: eigene Tabelle plus Worker-Poller

Die API schreibt einen Versandauftrag in `email_deliveries`, in derselben
Transaktion wie die fachliche Änderung. Der Worker pollt die Tabelle,
versendet und bucht das Ergebnis.

Erwogen und verworfen:

- Synchroner Versand aus dem API-Request. Am wenigsten Code, aber bei
  Provider-Störung scheitert die Einladung oder die Mail geht still verloren.
  Verletzt «kein versteckter Datenverlust».
- BullMQ in Redis. Steht im Tech-Stack, ist im Repository aber nicht in
  Betrieb. Der Worker bekäme erstmals eine Redis-Abhängigkeit, und der
  Auftrag läge bis zum Versand nur in Redis. Mehr Infrastruktur für denselben
  Nutzen.
- Dritter Konsument an `outbox_events`. Der Kommentar an der Tabelle verlangt
  bei einem dritten Konsumenten eine Neubewertung. Ein Mailauftrag ist zudem
  kein Domänenereignis, sondern ein Auftrag mit eigenem Lebenszyklus,
  eigenem Empfänger und eigenem Inhalt.

### Provider: Resend über HTTP, ohne SDK

Resend ist eingerichtet, die Domain `dartbase.ch` ist verifiziert (SPF,
DKIM, DMARC bei Cloudflare), Region `eu-west-1` (Irland). Der Adapter ruft
`POST https://api.resend.com/emails` direkt mit `fetch` auf. Das SDK bringt
für einen einzigen Endpunkt keinen Nutzen und eine weitere Abhängigkeit.

Der `Idempotency-Key`-Header trägt die ID der Versandzeile. Stirbt der
Worker zwischen Versand und Buchung, rollt die Sperrtransaktion zurück, die
Zeile bleibt offen, und der Wiederholungsversuch liefert dank gleichem
Schlüssel dieselbe Mail nicht erneut aus. Ob der Header im aktuellen Resend-API-Stand
so heisst und sich so verhält, ist im Implementierungsplan gegen die
Resend-Dokumentation zu verifizieren, bevor der Adapter geschrieben wird.

### Templates rendert der Worker, nicht die API

Die Versandzeile trägt die Template-Eingaben als `payload`, nicht den
fertigen Mailtext. Der Worker rendert beim Versand. Vorteile: Änderungen an
Wortlaut oder Layout wirken auch auf noch offene Aufträge, die Zeile bleibt
klein, und Text- wie HTML-Variante entstehen an einer Stelle.

### Klartext nur bis zum Versand

Der Einladungslink enthält den Klartext-Code, dessen Hash in
`organization_invitations` liegt. Er steht bis zum Versand im `payload` der
Versandzeile. Nach erfolgreichem Versand oder Dead-Letter wird `payload` auf
`null` gesetzt. Das Fenster, in dem der Klartext in der Datenbank liegt,
ist damit auf die Zeit bis zum Versand begrenzt, im Normalfall Sekunden.

### Code im URL-Fragment

Der Link lautet `{WEB_ORIGIN}/einladung/{invitationId}#code={claimToken}`.
Das Fragment verlässt den Browser nicht: es erscheint weder in Server-Logs
noch im Referer noch in Railway- oder Cloudflare-Protokollen. Die Seite liest
es clientseitig und sendet es nur im Body an die API.

### Erneut senden rotiert den Code

Weil nur der Hash gespeichert ist, kann der alte Code nicht erneut versendet
werden. «Erneut senden» erzeugt einen neuen Code, ersetzt den Hash, setzt den
Ablauf auf 48 Stunden ab jetzt und legt eine neue Versandzeile an. Der alte
Code wird damit ungültig. Das ist gewollt: Eine Einladung hat zu jedem
Zeitpunkt genau einen gültigen Code.

### Fallback bleibt

Die API antwortet beim Erstellen und beim erneuten Senden weiterhin mit dem
Klartext-Code. Die Oberfläche zeigt ihn einmalig als Fallback für andere
Kanäle. Das Anmelde-Panel mit manuellem Code-Feld bleibt unverändert.

## Komponenten

### `packages/notifications` (neu)

Infrastrukturfrei bis auf `fetch`. Importiert weder Drizzle noch NestJS
noch Next.js.

```ts
interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

type EmailSendResult =
  | { readonly kind: "sent"; readonly providerMessageId: string }
  | { readonly kind: "retryable"; readonly reason: string }
  | { readonly kind: "rejected"; readonly reason: string };

interface EmailSender {
  send(message: EmailMessage, idempotencyKey: string): Promise<EmailSendResult>;
}
```

- `renderInvitationEmail(input)` und `renderPasswordResetEmail(input)`:
  reine Funktionen, liefern `subject`, `text`, `html`. Eingaben werden für
  HTML escaped; Namen und Organisationsbezeichnungen sind Benutzereingaben.
- `renderEmailDelivery(kind, payload)`: wählt anhand von `kind` das Template
  und validiert `payload` mit dem passenden Zod-Schema aus
  `packages/schemas`. Ungültiger Payload ist ein `rejected`-Fall, kein
  Absturz des Pollers.
- `ResendEmailSender`: `fetch` gegen die Resend-API. Abbildung der Antwort:
  2xx → `sent`; 429, 5xx, Netzwerkfehler, Timeout → `retryable`; übrige 4xx
  → `rejected` mit Fehlertext aus der Antwort. Timeout 10 Sekunden.
- `LoggingEmailSender`: schreibt Empfänger, Betreff und Textvariante ins
  strukturierte Log und liefert `sent` mit einer generierten ID. Für lokale
  Entwicklung, CI und E2E.
- `createEmailSender(environment, logger)`: wählt anhand von
  `EMAIL_PROVIDER` den Adapter.

Mailinhalt: Absender, Zweck in einem Satz, Handlungsaufforderung mit Link,
Ablaufzeitpunkt, Hinweis «Wenn du diese Mail nicht erwartet hast, kannst du
sie ignorieren.» Keine Bilder, kein Tracking. Klick-Tracking und
Öffnungs-Tracking bleiben in Resend deaktiviert.

### `packages/config`: Umgebung

Ergänzungen an `applicationEnvironmentSchema`, weil API und Worker dasselbe
Schema lesen:

| Variable | Typ | Vorgabe | Bemerkung |
|---|---|---|---|
| `EMAIL_PROVIDER` | `resend` \| `log` | `log` | |
| `RESEND_API_KEY` | string, min. 1 | – | Pflicht bei `resend`, sonst scheitert der Start (`superRefine`, wie `TRUST_PROXY_HOPS` in Produktion) |
| `EMAIL_FROM` | string | `dartbase <noreply@dartbase.ch>` | Anzeigename plus Adresse |

Links werden aus dem bestehenden `WEB_ORIGIN` gebaut. `.env.example`
dokumentiert die drei Variablen. Produktion und Staging erhalten je einen
eigenen Resend-API-Key (Railway-Variablen, gesperrt für Agenten, setzt der
Betreiber).

### `packages/schemas`

- `emailDeliveryKindSchema`: `INVITATION` | `PASSWORD_RESET`.
- `invitationEmailPayloadSchema`: `organizationName`, `inviterName`, `role`,
  `invitationUrl`, `expiresAt`.
- `passwordResetEmailPayloadSchema`: `recipientName`, `resetUrl`.
- `invitationDeliveryStatusSchema`: `pending` | `sent` (mit `sentAt`) |
  `failed` (mit `failedAt`). Ergänzt `invitationSchema` um `lastDelivery`
  (nullable, für Einladungen aus der Zeit vor diesem Feature).
- `invitationPreviewSchema`: `organizationName`, `role`, `email`,
  `expiresAt`.
- `previewInvitationInputSchema`: `claimToken`.

### `packages/database`

Tabelle `email_deliveries`, Migration `0034_email_deliveries.sql`:

| Spalte | Typ | Bemerkung |
|---|---|---|
| `id` | uuid PK, `defaultRandom()` | zugleich Idempotency-Key |
| `organization_id` | uuid, nullable, FK `organizations` `on delete cascade` | null beim Passwort-Reset |
| `kind` | varchar(30), not null | Check: `INVITATION`, `PASSWORD_RESET` |
| `recipient` | varchar(320), not null | |
| `payload` | jsonb, nullable | null nach Versand oder Dead-Letter |
| `created_at` | timestamptz, not null, `now()` | Sortierung |
| `sent_at` | timestamptz, nullable | |
| `provider_message_id` | varchar(200), nullable | |
| `attempts` | integer, not null, 0 | |
| `not_before` | timestamptz, nullable | Backoff |
| `dead_lettered_at` | timestamptz, nullable | |
| `last_error` | text, nullable | |

Indexe: partiell auf `(created_at)` where `sent_at is null and
dead_lettered_at is null` für den Poller; `(sent_at)` für die Aufräumregel;
`(organization_id, created_at)` für die Zustellstatus-Abfrage der
Einladungsliste. Check-Constraint: `payload is not null or sent_at is not
null or dead_lettered_at is not null` (offene Aufträge haben immer Inhalt).

Um die Versandzeile einer Einladung zuzuordnen, trägt `payload` beim
`INVITATION`-Fall die `invitationId`; für die Statusabfrage nach dem Nullen
des Payloads braucht es aber eine Spalte: `invitation_id` uuid, nullable, FK
`organization_invitations` `on delete cascade`. Index `(invitation_id,
created_at)`.

Hilfsfunktionen analog zu `outbox.ts`: `emailDeliveryPending(now)` als
SQL-Fragment, `recordEmailDeliveryFailure(...)` mit Backoff aus den
bestehenden Konstanten `OUTBOX_BACKOFF_BASE_MS`, `OUTBOX_BACKOFF_CAP_MS`,
`OUTBOX_MAX_ATTEMPTS`; die Konstanten werden dafür nicht dupliziert, sondern
wiederverwendet.

### `apps/api`

**Einladung erstellen** (`OrganizationsRepository.createInvitation`): in der
bestehenden Transaktion zusätzlich `INSERT INTO email_deliveries` mit
`kind = INVITATION`, `recipient = email`, `invitation_id`, `payload` aus
Organisationsname, Name der einladenden Person, Rolle, Link und Ablauf. Der
Organisationsname und der Name der einladenden Person werden innerhalb der
Transaktion gelesen. Die Antwort bleibt `CreatedInvitation` mit `claimToken`.

**Erneut senden**: `POST
/organizations/:organizationId/invitations/:invitationId/resend`, Permission
`organization:manage_members`, sensitives Rate-Limit. Repository-Methode
`resendInvitation({ organizationId, invitationId, actor })`: in einer
Transaktion `UPDATE organization_invitations SET claim_token_hash,
expires_at WHERE id AND organization_id AND status = 'PENDING'`; trifft kein
Datensatz, HTTP 404 mit Code `INVITATION_NOT_OPEN`. Dann Versandzeile
anlegen, Audit-Eintrag `INVITATION_RESENT`. Antwort `CreatedInvitation`.

**Einladungsliste**: `listInvitationsOfOrganization` liefert pro Einladung
`lastDelivery` aus der jüngsten Zeile in `email_deliveries` mit
`invitation_id` (Lateral Join oder `DISTINCT ON`). Abbildung: `sent_at`
gesetzt → `sent`; `dead_lettered_at` gesetzt → `failed`; sonst `pending`.

**Vorschau**: `POST /invitations/:invitationId/preview`, öffentlich (kein
Session-Guard), sensitives Rate-Limit, Body `{ claimToken }`. Lädt die
Einladung mit Status `PENDING` und Ablauf in der Zukunft, vergleicht den
Hash mit `invitationClaimMatches` (konstante Zeit). Treffer → Organisations-
name, Rolle, E-Mail, Ablauf. Kein Treffer, gleich aus welchem Grund → HTTP
404 mit Code `INVITATION_NOT_FOUND`. Die Antwort unterscheidet nicht
zwischen «existiert nicht», «falscher Code» und «abgelaufen».

**Better Auth** (`auth.factory.ts`):

```ts
emailAndPassword: {
  enabled: true,
  minPasswordLength: 10,
  maxPasswordLength: 128,
  revokeSessionsOnPasswordReset: true,
  sendResetPassword: async ({ user, url }) => {
    await enqueuePasswordResetEmail(database, { recipient: user.email, recipientName: user.name, resetUrl: url });
  },
},
```

`/request-password-reset` kommt in `rateLimit.customRules` neben Sign-in und
Sign-up. Der Hook läuft ausserhalb einer eigenen Transaktion; Better Auth
hat das Reset-Token zu diesem Zeitpunkt bereits persistiert. Scheitert der
Insert, wirft der Hook, Better Auth antwortet mit Fehler, und die Person
kann es erneut versuchen. Ein Reset-Token ohne Mail ist unkritisch: es läuft
nach einer Stunde ab.

Die konkreten Hook-Signaturen von Better Auth 1.7.1 (`sendResetPassword`,
`revokeSessionsOnPasswordReset`, clientseitig `requestPasswordReset` und
`resetPassword`) sind im Plan gegen die installierten Typdefinitionen zu
prüfen, bevor die Aufrufe geschrieben werden.

### `apps/worker`

`processEmailDeliveries({ database, sender, render, logger, limit, now })`,
Aufruf im Sekundentakt neben dem Statistik-Tick, mit eigenem
Wiedereintrittsschutz:

1. Transaktion öffnen, bis 5 offene Zeilen mit `FOR UPDATE SKIP LOCKED`
   nach `created_at` beanspruchen.
2. Pro Zeile im Savepoint: `payload` validieren und rendern. Ungültig →
   Dead-Letter mit Fehlertext, `payload = null`.
3. `sender.send(message, row.id)` sequenziell je Zeile, während die Sperre
   hält. Die Sperre bleibt bewusst bis zur Buchung bestehen, damit eine
   zweite Replik die Zeile nicht greift, solange der Versand läuft — dasselbe
   Muster wie beim Statistik-Konsumenten, der die Sperre über die Aggregation
   hält. Bei 5 Zeilen und 10 Sekunden Timeout je Aufruf ist die Transaktion
   im schlechtesten Fall 50 Sekunden offen; das ist der Grund für die kleine
   Stapelgrösse. Eine lease-basierte Alternative (`claimed_at`-Spalte, Sperre
   sofort freigeben) wurde verworfen: sie braucht eine Verfallslogik für
   abgestürzte Worker und bringt bei einem einzigen Worker nichts.
4. `sent` → `sent_at`, `provider_message_id`, `payload = null`. `retryable`
   → `attempts + 1`, `not_before` per Backoff, `last_error`; ab
   `OUTBOX_MAX_ATTEMPTS` Dead-Letter mit `payload = null`. `rejected` →
   sofort Dead-Letter.
5. Dead-Letter erzeugt ein Log-Ereignis `email.dead_lettered` auf Level
   `error` mit `deliveryId`, `kind`, `attempts`, `lastError`. Empfänger-
   adresse nicht ins Log.

Aufräumregel: `pruneEmailDeliveries` löscht Zeilen mit `sent_at` oder
`dead_lettered_at` älter als 30 Tage, im stündlichen Prune-Tick.

### `apps/web`

- **`/einladung/[invitationId]`**: Client-Komponente. Liest `#code=` aus
  `window.location.hash`. Ohne Code: Hinweis «Link unvollständig» mit Verweis
  auf das manuelle Code-Feld auf der Startseite. Mit Code: Preview laden.
  Fehler → «Diese Einladung ist ungültig oder abgelaufen. Bitte die
  einladende Person um eine neue Einladung.» Erfolg → Karte «Du bist zu
  {Organisation} als {Rolle} eingeladen» und je nach Sitzung:
  - keine Sitzung: Formular Name und Passwort, E-Mail als nicht editierbares
    Feld. Sign-up mit dem bestehenden Header
    `x-dartbase-invitation-claim`, danach `POST
    /invitations/:id/accept` mit demselben Code, dann Weiterleitung auf `/`.
  - Sitzung mit passender E-Mail: Button «Einladung annehmen», dann `/`.
  - Sitzung mit anderer E-Mail: Hinweis mit Abmelde-Button.
- **`/passwort/vergessen`**: Formular mit E-Mail. Ruft
  `authClient.requestPasswordReset({ email, redirectTo:
  `${origin}/passwort/neu` })`. Antwort immer: «Wenn ein Konto mit dieser
  Adresse existiert, ist eine Mail unterwegs.»
- **`/passwort/neu`**: liest `token` aus dem Query-String (dorthin leitet
  Better Auth nach dem Klick). Formular neues Passwort plus Wiederholung,
  Mindestlänge 10. `authClient.resetPassword({ newPassword, token })`. Erfolg
  → Hinweis und Link zur Anmeldung. Fehler (Token ungültig oder abgelaufen)
  → Hinweis mit Link zu `/passwort/vergessen`.
- **Anmelde-Panel**: Link «Passwort vergessen?» unter dem Anmeldeformular.
- **Mitgliederseite**: Spalte oder Badge «Mail: ausstehend / versendet am
  … / fehlgeschlagen» je offener Einladung, Button «Erneut senden» mit
  Mutation auf den neuen Endpunkt; Erfolg zeigt den neuen Code einmalig wie
  beim Erstellen.
- **Einladungsformular**: Erfolgstext «Einladung erstellt, Mail an {E-Mail}
  ist unterwegs. Falls sie nicht ankommt, kannst du diesen Code weitergeben.»

Alle neuen Seiten Mobile First, Formularfelder mit Label, Fehlerzustände als
Text, Fokus sichtbar. Passwortfeld mit Umschalter Anzeigen/Verbergen wie im
bestehenden Panel, falls dort vorhanden; sonst ohne.

## Abläufe

**Einladen**

```
POST /organizations/:org/invitations
  BEGIN
    INSERT organization_invitations (hash)
    INSERT email_deliveries (INVITATION, payload mit Klartext-Link)
    INSERT audit_events
  COMMIT
  → 201 { invitation, claimToken }

Worker-Tick
  SELECT … FOR UPDATE SKIP LOCKED
  render → Resend POST (Idempotency-Key = id)
  UPDATE sent_at, provider_message_id, payload = null
```

**Annehmen über Link**

```
Browser öffnet /einladung/:id#code=…
  POST /invitations/:id/preview { claimToken }  → 200 Vorschau
  POST /api/auth/sign-up/email (Header x-dartbase-invitation-claim)
  POST /invitations/:id/accept { claimToken }   → Mitgliedschaft
  → /
```

**Passwort-Reset**

```
POST /api/auth/request-password-reset { email, redirectTo }
  Better Auth: Token persistieren → sendResetPassword-Hook
    INSERT email_deliveries (PASSWORD_RESET, payload mit URL)
  → 200 (immer)
Worker versendet
Klick → GET /api/auth/reset-password/:token?callbackURL=/passwort/neu
  → Redirect /passwort/neu?token=…
POST /api/auth/reset-password { newPassword, token }
  → Passwort gesetzt, alle Sitzungen widerrufen
```

## Fehlerbehandlung

| Situation | Verhalten |
|---|---|
| Resend nicht erreichbar | Zeile bleibt offen, Backoff 1 s … 5 min, nach 8 Versuchen Dead-Letter, Log `error`. Einladung selbst ist erfolgreich angelegt. Liste zeigt «ausstehend», nach Dead-Letter «fehlgeschlagen». |
| Ungültige Empfängeradresse (Resend 4xx) | Sofort Dead-Letter. Liste zeigt «fehlgeschlagen». Einladende Person kann Einladung zurückziehen und neu erstellen. |
| Worker stirbt nach Versand, vor Buchung | Nächster Tick sendet erneut mit demselben Idempotency-Key; Resend liefert nicht doppelt aus. |
| Zwei Worker-Repliken | `SKIP LOCKED`, jede Zeile nur einmal in Arbeit. |
| Payload passt nicht zum Schema | Dead-Letter mit Fehlertext, Poller läuft weiter. |
| Link ohne Fragment geöffnet | Seite erklärt den fehlenden Code und verweist auf das manuelle Feld. |
| Abgelaufener oder rotierter Code | Preview 404, Seite bittet um neue Einladung. |
| Reset-Token abgelaufen | Better Auth lehnt ab, Seite verweist auf «Passwort vergessen». |
| `EMAIL_PROVIDER=resend` ohne Key | Start von API und Worker scheitert mit klarer Meldung. |

## Sicherheit

- Alle Einladungsendpunkte tragen `organization_id` im `WHERE`. Der
  Preview-Endpunkt ist öffentlich, gibt aber nur nach erfolgreichem
  Hash-Vergleich in konstanter Zeit etwas zurück und antwortet für alle
  Fehlerursachen identisch.
- Erneut senden und Preview laufen unter dem sensitiven Rate-Limit;
  `/request-password-reset` unter dem sensitiven Limit von Better Auth.
- Der Klartext-Code liegt nur im URL-Fragment und im Request-Body; nie im
  Query-String, nie in Server-Logs. Das Log des Workers enthält keine
  Empfängeradressen und keine Links.
- Erneut senden ist auditiert (`INVITATION_RESENT`), wie Erstellen und
  Zurückziehen.
- `revokeSessionsOnPasswordReset` beendet nach einem Reset alle Sitzungen.
- Templates escapen alle Benutzereingaben für HTML. Der Link wird aus
  `WEB_ORIGIN` und server-generierten Werten gebaut, nie aus Client-Daten.
- Keine Secrets im Code; `RESEND_API_KEY` nur als Railway-Variable.

## Datenschutz

Empfängeradresse, Anzeigename der eingeladenen und der einladenden Person
sowie der Organisationsname gehen an Resend, Region Irland (EU). Das ist
eine Auftragsverarbeitung. Ausserhalb des Codes zu erledigen: Eintrag in
der Datenschutzerklärung, Auftragsverarbeitungsvertrag mit Resend (DPA über
das Resend-Konto), Vermerk im Verzeichnis der Verarbeitungstätigkeiten.
Fachliche Einschätzung dazu bei der zuständigen Stelle einholen; dieses
Dokument ersetzt keine rechtliche Beurteilung.

## Tests

- **Unit, `packages/notifications`**: Templates (Snapshot Text und HTML,
  Link enthalten, `<script>` im Namen wird escaped, Ablaufdatum formatiert
  als TT.MM.JJJJ HH:MM). `ResendEmailSender` gegen gemocktes `fetch`: 200 →
  sent mit ID; 429 und 500 → retryable; 422 → rejected mit Fehlertext;
  Netzwerkfehler und Timeout → retryable; Header `Authorization`,
  `Idempotency-Key`, `Content-Type` gesetzt; Body enthält `from`, `to`,
  `subject`, `text`, `html`. `createEmailSender` wählt nach Provider.
- **Unit, `packages/config`**: `EMAIL_PROVIDER=resend` ohne Key scheitert;
  Vorgaben greifen.
- **Integration, `packages/database`**: Migration läuft; Check-Constraints
  auf `kind` und auf «offen impliziert payload» greifen; Cascade bei
  Löschen der Organisation.
- **Integration, API**: Einladen erzeugt genau eine Versandzeile mit
  korrektem Payload und Link im erwarteten Format; Rollback der Transaktion
  hinterlässt keine Zeile. Erneut senden: neuer Hash, alter Code scheitert
  beim Accept, Ablauf verlängert, zweite Zeile, Audit-Eintrag; 404 bei
  angenommener oder zurückgezogener Einladung; Tenant-Isolation (fremde
  Organisation → 404); Permission-Matrix ergänzt. Preview: gültig → 200
  mit Feldern; falscher Code, abgelaufen, fremde ID → identisches 404.
  Einladungsliste liefert `lastDelivery` in allen drei Zuständen.
  Reset-Hook erzeugt Zeile mit URL; unbekannte Adresse erzeugt keine Zeile
  und dieselbe HTTP-Antwort.
- **Integration, Worker**: Fake-Sender mit steuerbarem Ergebnis. `sent` →
  gebucht, Payload null. `retryable` → attempts, not_before in der Zukunft,
  Zeile im nächsten Tick übersprungen; nach `OUTBOX_MAX_ATTEMPTS`
  Dead-Letter mit Payload null und Log `error`. `rejected` → sofort
  Dead-Letter. Ungültiger Payload → Dead-Letter. Zwei parallele Läufe →
  jede Zeile genau einmal gesendet. Prune löscht alte, lässt offene stehen.
- **E2E, Playwright, `EMAIL_PROVIDER=log`**: Einladung erstellen, Link aus
  der Dev-Datenbank (Test-Helfer liest `payload` vor dem Versand oder das
  Log), `/einladung/…#code=…` öffnen, Vorschau sichtbar, registrieren, im
  Dashboard mit Organisation landen. Passwort vergessen anfordern, Reset-
  URL aus dem Log, neues Passwort setzen, alte Sitzung ungültig, mit neuem
  Passwort anmelden. Mitgliederseite zeigt Zustellstatus und «Erneut
  senden» liefert neuen Code.
- **Staging**: einmalige manuelle Prüfung mit `EMAIL_PROVIDER=resend` an
  das Testkonto; Ergebnis im Plan-Abnahmeprotokoll festhalten.

## Betrieb

- Railway-Variablen je Environment: `EMAIL_PROVIDER=resend`,
  `RESEND_API_KEY`, optional `EMAIL_FROM`. Setzt der Betreiber, nicht der
  Agent. Reihenfolge beim Rollout: erst Migration und Deploy mit
  `EMAIL_PROVIDER=log`, prüfen, dann auf `resend` umschalten.
- `infrastructure/railway.md` erhält einen Abschnitt E-Mail mit Provider,
  Region, Domain-Status und den Variablen.
- Dead-Letter erscheinen als `error` im Log; der bestehende Fehler-Grep und
  der Better-Stack-Monitor decken sie ab. Eine Abfrage für offene und
  dead-lettered Zeilen gehört in die Betriebsdoku.
- ADR 0010 erhält einen Nachtrag: Zustellung des Codes per Mail, Rotation
  beim erneuten Senden, Klartext bis zum Versand. Alternativ ein neues ADR
  0017 «Ausgehende E-Mails», das den Versandweg festhält; das Feature legt
  ADR 0017 an und verlinkt es aus ADR 0010.

## Offene Punkte für den Plan

- Resend-API: Feldnamen des Request-Bodys, Idempotency-Header, Fehlerformat
  gegen die aktuelle Dokumentation prüfen.
- Better Auth 1.7.1: Signaturen von `sendResetPassword`, Verhalten von
  `redirectTo`/`callbackURL` und den Query-Parameter auf der Zielseite
  gegen die installierten Typen und den Quelltext prüfen.
- Anzeigename der einladenden Person: `users.name` aus Better Auth; falls
  leer, Organisationsname allein.
