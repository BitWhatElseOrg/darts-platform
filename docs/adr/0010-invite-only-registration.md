# ADR 0010: Einladungsgebundene Registrierung und Verwaltungszugang

- Status: Akzeptiert
- Datum: 2026-08-26

## Kontext

Eine offene Selbstregistrierung würde unbekannten Personen Konten auf der
Plattform erlauben, obwohl Organisationen, Rollen und Turnierdaten bewusst
mandantenbezogen verwaltet werden. Gleichzeitig darf das Ausblenden eines
Navigationsbuttons nicht als einzige Autorisierung dienen.

## Entscheidung

- Better Auth prüft vor jeder Benutzeranlage in PostgreSQL, ob für die
  normalisierte E-Mail-Adresse eine Einladung mit Status `PENDING`, einem
  Ablaufzeitpunkt in der Zukunft und einem passenden kryptografischen
  Einladungscode existiert. In PostgreSQL wird nur der SHA-256-Hash gespeichert.
- Fehlt eine gültige Einladung, wird die Registrierung serverseitig mit HTTP 403
  abgewiesen. Direkte Aufrufe des Auth-Endpunkts umgehen diese Prüfung nicht.
- Nach erfolgreicher Kontoerstellung bleibt die Einladung offen, bis der
  Benutzer sie ausdrücklich mit demselben Code annimmt. Der Claim wird dabei
  atomisch einmalig verbraucht; erst dann wird die zugewiesene
  Organisationsmitgliedschaft erstellt.
- Der Link «Turnierleitung» wird nur für Organisationen angezeigt, in denen die
  Rolle `tournament:update` gewährt.
- API-Guard, expliziter Tenant-Kontext und Permission-Prüfung bleiben unabhängig
  von der UI die verbindliche Sicherheitsgrenze.

## Folgen

- Neue Benutzer benötigen vor der Registrierung eine Einladung durch `OWNER`
  oder `ADMIN`, den zugehörigen Einladungscode und exakt dieselbe E-Mail-Adresse.
- Der erste Benutzer einer neuen Installation benötigt einen kontrollierten
  Bootstrap-Prozess ausserhalb der öffentlichen Registrierung.
- Rollen wie `VIEWER`, `MEMBER` und `SCORER` sehen keinen Einstieg in die
  Turnierverwaltung, sofern keine weitere zugängliche Organisation die nötige
  Permission gewährt.
- Integrationstests prüfen gültige und fehlende Einladungen; Browser-Tests
  prüfen den sichtbaren Zugang für Turnierleitung und Viewer.

## Nachtrag 20.09.2026

Der Einladungscode wird seit ADR 0017 per Mail zugestellt: Link
`{WEB_ORIGIN}/einladung/{id}#code={claimToken}`, Code im Fragment. Die
Oberfläche zeigt Link und Code weiterhin einmalig als Fallback. «Erneut
senden» erzeugt einen neuen Code und ersetzt den Hash; der alte Code wird
ungültig. Der Klartext liegt bis zum Versand im `payload` der Versandzeile
und wird danach geleert. Ein öffentlicher Vorschau-Endpunkt liefert
Organisation, Rolle und Adresse nur nach erfolgreichem Hash-Vergleich.
