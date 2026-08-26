# ADR 0008: Dauerhafte Offline-Queue und Board-Controller-Lock

## Status

Akzeptiert – 26. August 2026

## Entscheid

Score-Commands werden vorübergehend als vollständige, idempotente HTTP-Befehle
in IndexedDB gespeichert, wenn das Gerät offline ist oder der Transport
abbricht. Nach Reconnect wird exakt dieselbe `commandId` wiederholt. Bis zur
Bestätigung oder Konfliktauflösung bleibt die Queue sichtbar und die nächste
Score-Eingabe gesperrt.

Ein lokaler, zwischen Browser-Tabs synchronisierter Controller-Lock hält pro
Match eine kurzlebige Lease. Der aktive Controller erneuert sie per Heartbeat;
andere Geräte zeigen den Lock und können ihn bewusst übernehmen. Die
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
