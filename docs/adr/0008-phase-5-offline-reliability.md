# ADR 0008: Dauerhafte Offline-Queue und Board-Controller-Lock

## Status

Akzeptiert – 26. August 2026

## Entscheid

Score-Commands werden vorübergehend als vollständige, idempotente HTTP-Befehle
in IndexedDB gespeichert, wenn das Gerät offline ist oder der Transport
abbricht. Nach Reconnect wird exakt dieselbe `commandId` wiederholt. Bis zur
Bestätigung oder Konfliktauflösung bleibt die Queue sichtbar und die nächste
Score-Eingabe gesperrt.

Ein serverseitiger Controller-Lock hält pro Match eine kurzlebige, tenant-sichere
Lease. Der aktive Controller erneuert sie per Heartbeat; andere Geräte zeigen
den Lock und können ihn bewusst und auditiert übernehmen. Die
serverseitige Versionsprüfung bleibt unabhängig davon die letzte Instanz.

Der Service Worker cached nur statische Assets und eine neutrale Offline-Seite.
Authentifizierte HTML-Antworten werden nicht gespeichert.

## Folgen

- Ein bereits bestätigter Klick geht bei einem kurzen WLAN-Ausfall nicht
  verloren.
- Mehrere offline aufeinander aufbauende Visits werden nicht spekulativ
  berechnet; zuerst wird der offene Befehl synchronisiert.
- Versionskonflikte werden nie automatisch verworfen.
- Der Board-Lock verbessert die Bedienung, ersetzt aber weder Autorisierung noch
  Optimistic Concurrency.

## Nachtrag 25.09.2026: Karenz nach Ablauf der Lease

Die Lease gilt 10 s, der Heartbeat läuft alle 3 s. Ein Gerät mit
Sperrbildschirm oder Tab im Hintergrund verliert sie deshalb nach wenigen
Sekunden – und ein zweites Gerät, das die Scoringfläche nur öffnet, übernahm
sie bis hierher stillschweigend (Probelauf 25.09.2026, Befund 5). Seither
gilt eine abgelaufene Lease eines anderen Geräts fünf Minuten lang als «kurz
verlassen» (`LEASE_GRACE_MS` in `matches.repository.ts`): ohne `force`
antwortet der Server mit `owned: false`, die Fläche zeigt «Ein anderes Gerät
steuert dieses Board» mit «Steuerung übernehmen». Derselbe Controller erhält
seine Lease jederzeit zurück; nach der Karenz gilt das Board als verlassen.
Spec: `docs/superpowers/specs/2026-09-25-lease-karenz-turnier-loeschen-design.md`.
