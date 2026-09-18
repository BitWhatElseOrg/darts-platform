# Protokoll: Rate-Limits und Fehlerformat gegen Staging

Datum: 17.09.2026, Umgebung `staging`, API `https://darts-platformapi-staging.up.railway.app`,
Deploy `develop` 316a9f7. Werkzeug: `curl`, parallel über `xargs -P`.
Spec: Block D3 und D6 in `docs/superpowers/specs/2026-09-17-go-live-testprogramm-design.md`.

## D6 Fehlerformat – grün

| Fall | Erwartung | Ergebnis |
| --- | --- | --- |
| Ungültiges JSON | 400, `VALIDATION_ERROR`, `correlationId` | 400, `VALIDATION_ERROR`, `correlationId` vorhanden |
| Unbekannte Route | 404, einheitliches Format | 404, `RESOURCE_NOT_FOUND` |
| 2 MB Body | 413, kein Stacktrace | 413, Code `AVATAR_TOO_LARGE` |
| Ohne Session auf `/organizations` | 401 | 401, `AUTHENTICATION_REQUIRED` |

Befund D6-1 (klein): Der Code `AVATAR_TOO_LARGE` erscheint auch bei einem zu
grossen Body auf der Login-Route. Der Body-Limit-Handler ist offenbar global
auf den Avatar-Fall benannt. Kein Sicherheitsproblem, aber irreführend.

## D3 Rate-Limits – rot

### Seriell (Anfragen nacheinander, je ca. 0,3 bis 0,5 s)

| Fall | Erwartung | Ergebnis |
| --- | --- | --- |
| 12× Login mit falschem Passwort | ab Nr. 11 → 429 | 12× 401, kein 429 |
| 310× `GET /organizations` | ab Nr. 301 → 429 | 310× 401, danach `x-ratelimit-remaining: 133` |

Der zweite Fall ist nicht aussagekräftig: die 310 Anfragen dauerten länger als
das 60-Sekunden-Fenster. Der erste Fall lag klar innerhalb des Fensters.

### Parallel

| Fall | Erwartung | Ergebnis |
| --- | --- | --- |
| 25× Login gleichzeitig | 10× 401, 15× 429 | 17× 401, 8× 429 |
| 400× `GET /organizations`, 40 gleichzeitig | 300× 401, 100× 429 | 400× 401, kein 429; danach `x-ratelimit-remaining: 102` von 300 |

Befund D3-1 (hoch): Unter gleichzeitigen Anfragen zählt der Limiter nur etwa
die Hälfte. Nach 401 Anfragen stand der Zähler bei 198. Beim Login kamen 17
statt 10 Versuche durch. Das ist genau das Muster eines nicht-atomaren
Zählers (lesen, erhöhen, schreiben) oder eines Schlüssels, der nicht je
Client stabil ist. Der Angriffsfall (Passwort-Raten mit parallelen
Verbindungen) ist damit nur teilweise gebremst.

Befund D3-2 (mittel): Im seriellen Login-Fall kam innerhalb des Fensters kein
429. Ursache noch offen; wird zusammen mit D3-1 in der Implementierung
geprüft (`apps/api`, Rate-Limit-Konfiguration und Auth-Rate-Limit-Storage).

## Nächste Schritte

1. Implementierung lesen: Zählerspeicher (Redis), Schlüsselbildung
   (`TRUST_PROXY_HOPS`, `X-Forwarded-For`), Atomarität.
2. Integrationstest, der 50 parallele Anfragen gegen eine Route mit Limit 10
   schickt und genau 10 Erfolge erwartet.
3. Nach dem Fix denselben Lauf gegen Staging wiederholen und hier ergänzen.

## Messung 18.09.2026 (Plan Task 3, Step 3)

Umgebung `staging`, `LOG_CLIENT_ADDRESS=true`. 12 Anfragen von einer
Maschine mit fester, öffentlicher Adresse gegen `/api/v1/health`, davon 6
mit gefälschtem `X-Real-IP: 198.51.100.7` und
`X-Forwarded-For: 198.51.100.8`. Ausgewertet über das Request-Log
(`ip`, `addressHeaders`).

| Merkmal | Ergebnis |
| --- | --- |
| `request.ip` (Fastify, `TRUST_PROXY_HOPS=1`) | `212.102.36.193` oder `212.102.36.194` — zwei abwechselnde Railway-Proxy-Adressen. Ursache von Befund D3-1 (zwei Rate-Limit-Eimer für einen Client). |
| `x-real-ip` | in allen 12 Anfragen die eigene öffentliche Adresse (in allen 12 Anfragen identisch) — auch in den 6 Anfragen mit gefälschtem Wert. Railway überschreibt den Header vollständig. |
| `x-forwarded-for` | in allen 12 Anfragen dieselbe öffentliche Adresse gefolgt von `212.102.36.19x` — Railway schreibt die ganze Kette neu; die gefälschte Adresse erschien nirgends. Client steht als erster Eintrag, der Proxy als letzter. |
| Railways interne Probe | `ip=100.64.0.2`, beide Header `null` — kein `x-real-ip` und kein `x-forwarded-for`. |

**Entscheidung: Fall A.** `X-Real-IP` wird von Railway zuverlässig
überschrieben und ist über alle 12 Anfragen stabil; die gefälschten Header
kamen nie durch. Rate-Limit-Schlüssel, Audit-Kontext (`ip`) und die an
Better Auth gereichte Adresse verwenden ab sofort `resolveClientAddress`
(`apps/api/src/common/client-address.ts`): mit vertrautem Hop
(`TRUST_PROXY_HOPS > 0`) `X-Real-IP`, sonst — inklusive Railways interner
Probe ohne beide Header — Rückfall auf `request.ip`. Verworfen: `TRUST_PROXY_HOPS`
auf 2 setzen und bei `X-Forwarded-For` bleiben — die Kettenlänge ist kein
von Railway zugesichertes Verhalten, die interne Probe schickt gar keine
Kette, und `X-Real-IP` ist der dokumentierte Vertrag dafür, `X-Forwarded-For`
nicht.

## Nachmessung 18.09.2026 – grün

Datum/Zeit ca. 13:57 UTC, Umgebung `staging`, Deploy `develop` 2311f2c
(Merge von PR #46, „Client-Adresse hinter Railway aus X-Real-IP"). Limits
auf Standardwerten (300 allgemein / 10 sensibel / 600 öffentlich pro
Minute). Werkzeug: `curl`, parallel über `xargs -P`, gegen die
Custom-Domain `api-staging.dartbase.ch` — dieselbe Ingress-Klasse wie die
produktive Custom-Domain, anders als der zuvor genutzte
`*.up.railway.app`-Host.

| Fall | Erwartung | vorher | nachher |
| --- | --- | --- | --- |
| Spoof-Gate: 4× `GET /api/v1/health` mit gefälschtem `X-Real-IP: 198.51.100.7` und `X-Forwarded-For: 198.51.100.8` | Log zeigt die eigene, reale Adresse; gefälschte Werte kommen nicht durch | nicht gemessen (Schritt 7 stand aus) | in allen 4 Anfragen `clientAddress` = die eigene öffentliche Adresse; roher `ip` weiterhin der Railway-Proxy (212.102.36.193 / .194); `x-real-ip` = eigene Adresse; `x-forwarded-for` = eigene Adresse gefolgt vom Proxy. Die gefälschten Werte erschienen in keinem Feld. |
| Allgemeine Stufe: 400× `GET /organizations`, 40 gleichzeitig | 300 frei, danach 429 | 400× 401, kein 429; Restzähler inkonsistent (Hinweis auf zwei Zähler, Befund D3-1) | 299× 401, 101× 429 (eine Anfrage zuvor für den Header-Check verbraucht, Summe 300 frei); Restzähler danach sechsmal 0 — eine einzige Zählreihe, kein Split mehr |
| Sensible Stufe: 25 parallele Login-Versuche | 10× 401, 15× 429 | 17× 401, 8× 429 | 10× 401, 15× 429 |
| Öffentliche Stufe (A5): 700× `GET /public/tournaments/<unbekannte UUID>/live`, 50 gleichzeitig | zwischen 50 und 150× 429 | 0× 429 (Block-A-Lauf) | 600× 404, 100× 429; die allgemeine Stufe blieb danach unverändert frei (401 statt 429) |

Damit ist der Verdacht aus Befund D3-1 (zwei Zähler pro Client) bestätigt
behoben: alle drei Stufen zählen wieder konsistent gegen einen einzigen
Client-Schlüssel.

**Offen bis Release:** Die Messung lief ausschliesslich gegen Staging. Für
Production ist dieselbe Probe (mindestens der Spoof-Gate-Fall gegen
`api.dartbase.ch`) nach dem Release nach `main` einmal zu wiederholen
(Flag `LOG_CLIENT_ADDRESS` dort kurz einschalten) — als letzter offener
Punkt unter D3, nicht als rot geführt.

## Produktionsprobe 18.09.2026 – grün

Datum/Zeit 18.09.2026, Umgebung `production`, API `https://api.dartbase.ch`,
Deploy `main` 051ddbf (Release-PR #49, gemergt 16:29, deployt ca. 16:40).
`LOG_CLIENT_ADDRESS` bleibt in Production bewusst aus (siehe
`infrastructure/railway.md`, Abschnitt Variablen); die Probe ist deshalb
verhaltensbasiert statt log-basiert: 25 parallele Fehl-Logins gegen
`https://api.dartbase.ch/api/v1/auth/sign-in/email`, jeder Versuch mit
einem eigenen gefälschten `X-Real-IP` (198.51.100.1–25) und
`X-Forwarded-For` (203.0.113.1–25).

| Merkmal | Erwartung | Ergebnis |
| --- | --- | --- |
| Verteilung der 25 parallelen Logins | 10× 401, 15× 429 (ein gemeinsamer Zähler) | 10× 401, 15× 429 |
| Restzähler der allgemeinen Stufe danach (6 Folgeanfragen) | eine einzige, fortlaufende Zählreihe | 299, 298, 297, 296, 295, 294 |

Würde Railway den `X-Real-IP`-Header nicht zuverlässig überschreiben, hätte
jeder der 25 gefälschten Absender einen eigenen Rate-Limit-Eimer bekommen
und alle 25 Versuche wären als 401 durchgekommen. Stattdessen zählten alle
25 Versuche gegen denselben Client-Schlüssel, exakt wie auf Staging
nachgemessen. Der Restzähler danach bestätigt eine einzige, konsistente
Zählreihe statt der zuvor beobachteten Aufspaltung (Befund D3-1).

**Ergebnis: D3 ist damit auch in Production grün.** Das im Abnahmeprotokoll
genannte Gate (Spoof-Probe gegen die Production-Domain nach dem Release) ist
erfüllt; der Restpunkt aus der Staging-Nachmessung ist geschlossen.
