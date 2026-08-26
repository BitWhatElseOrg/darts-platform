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
  normalisierte E-Mail-Adresse eine Einladung mit Status `PENDING` und einem
  Ablaufzeitpunkt in der Zukunft existiert.
- Fehlt eine gültige Einladung, wird die Registrierung serverseitig mit HTTP 403
  abgewiesen. Direkte Aufrufe des Auth-Endpunkts umgehen diese Prüfung nicht.
- Nach erfolgreicher Kontoerstellung bleibt die Einladung offen, bis der
  Benutzer sie ausdrücklich annimmt. Erst dann wird die zugewiesene
  Organisationsmitgliedschaft erstellt.
- Der Link «Turnierleitung» wird nur für Organisationen angezeigt, in denen die
  Rolle `tournament:update` gewährt.
- API-Guard, expliziter Tenant-Kontext und Permission-Prüfung bleiben unabhängig
  von der UI die verbindliche Sicherheitsgrenze.

## Folgen

- Neue Benutzer benötigen vor der Registrierung eine Einladung durch `OWNER`
  oder `ADMIN` und müssen exakt dieselbe E-Mail-Adresse verwenden.
- Der erste Benutzer einer neuen Installation benötigt einen kontrollierten
  Bootstrap-Prozess ausserhalb der öffentlichen Registrierung.
- Rollen wie `VIEWER`, `MEMBER` und `SCORER` sehen keinen Einstieg in die
  Turnierverwaltung, sofern keine weitere zugängliche Organisation die nötige
  Permission gewährt.
- Integrationstests prüfen gültige und fehlende Einladungen; Browser-Tests
  prüfen den sichtbaren Zugang für Turnierleitung und Viewer.
