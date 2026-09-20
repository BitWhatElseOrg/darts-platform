# ADR 0017: Ausgehende E-Mails über eine Versandtabelle und den Worker

**Status:** Accepted
**Datum:** 20. September 2026

## Kontext

Bis hierher kannte die Plattform keinen Mailversand. Einladungscodes
wurden von Hand weitergegeben, ein vergessenes Passwort liess sich nur in
der Datenbank zurücksetzen. Die Spec
`docs/superpowers/specs/2026-09-20-email-versand-design.md` führt beide
Fälle ein.

Zu entscheiden war, wie Mails den Prozess verlassen: synchron aus dem
API-Request, über eine Redis-Queue (BullMQ) oder über eine Tabelle, die der
bestehende Worker pollt.

## Entscheidung

- Versandaufträge liegen in `email_deliveries`, angelegt in derselben
  Transaktion wie die fachliche Änderung (Einladung) beziehungsweise im
  Better-Auth-Hook (Passwort-Reset). Kein dritter Konsument an
  `outbox_events`: ein Mailauftrag ist kein Domänenereignis.
- Der Worker pollt im Sekundentakt mit `FOR UPDATE SKIP LOCKED`, Stapel 5,
  rendert das Template aus `packages/notifications` und ruft die
  Resend-HTTP-API mit der Zeilen-ID als `Idempotency-Key` auf. Die
  Zeilensperre bleibt über den Provider-Aufruf hinweg gehalten; deshalb ist
  der Stapel klein. Retry-Kurve und Dead-Letter wie bei `outbox_events`;
  endgültig abgelehnte Mails gehen sofort ins Dead-Letter.
- Jede Buchung eines Versandergebnisses läuft im eigenen Savepoint. Scheitert
  die Buchung selbst, wird der Fehlversuch in einem frischen Savepoint
  nachgebucht — sonst bliebe die Zeile unverändert offen und der nächste Tick
  riefe den Provider eine Sekunde später erneut auf. Mit der Nachbuchung
  greifen Backoff und Höchstzahl Versuche.
- `payload` trägt bis zum Versand die Template-Eingaben inklusive
  Klartext-Link und wird danach geleert. Der Klartext-Einladungscode liegt
  damit nur bis zum Versand in der Datenbank.
- Der Einladungslink trägt den Code im URL-Fragment. «Erneut senden»
  rotiert den Code; eine Einladung hat zu jedem Zeitpunkt genau einen
  gültigen Code.
- Provider: Resend, Region eu-west-1, Domain `dartbase.ch` mit SPF, DKIM
  und DMARC bei Cloudflare. Adapter ohne SDK. Provider `log` für
  Entwicklung, CI und E2E.

## Verworfen

- **Synchroner Versand**: bei Provider-Störung scheitert die Einladung oder
  die Mail geht still verloren.
- **BullMQ**: erstmalige Redis-Abhängigkeit des Workers; der Auftrag läge bis
  zum Versand nur in Redis.
- **Lease-Spalte statt gehaltener Sperre**: braucht eine Verfallslogik für
  abgestürzte Worker; bei einem Worker ohne Nutzen.

## Folgen

- Neue Umgebungsvariablen `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`;
  Rollout erst mit `log`, dann Umschalten auf `resend`. Die Vorgabe ist
  `log` — auch in Production; ohne ausdrücklich gesetztes
  `EMAIL_PROVIDER=resend` wird nichts versendet, sondern nur protokolliert.
  Es gibt bewusst keine Startprüfung, die in Production `resend` erzwingt:
  der Umschaltzeitpunkt gehört dem Betrieb (siehe
  `infrastructure/railway.md`). Umgekehrt scheitert der Start, wenn
  `resend` ohne `RESEND_API_KEY` gesetzt ist.
- Empfängeradressen und Anzeigenamen gehen an Resend (EU). Datenschutz-
  erklärung, Auftragsverarbeitungsvertrag und Verarbeitungsverzeichnis sind
  ausserhalb des Codes nachzuführen.
- Dead-Letter erscheinen als `error` im Worker-Log und in der
  Einladungsliste als «fehlgeschlagen».
- Vorschau, «Erneut senden» und `/auth/request-password-reset` liegen auf der
  engen Rate-Limit-Stufe (`RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE`): alle drei
  prüfen entweder einen Code oder erzeugen Mails an Dritte.
- Beim Passwort-Reset legt der Better-Auth-Hook den Versandauftrag an.
  Scheitert dieser Insert, fängt Better Auth die Ausnahme ab und antwortet
  trotzdem mit 200; die einzige Spur ist eine Fehlerzeile im Log, das Token
  verfällt nach einer Stunde und die Person kann erneut anfordern. Der Hook
  wirft deshalb eine konstante Meldung ohne Bind-Parameter — eine
  durchgereichte Drizzle-Fehlermeldung trüge den Reset-Link im Klartext ins
  Log.
