# ADR 0006: Realtime und öffentliche Live-Ansichten

## Status

Akzeptiert – 26. August 2026

## Entscheid

Geschäftliche Befehle bleiben HTTP-basiert. Erst nach einem erfolgreichen
Datenbank-Commit übernimmt ein Outbox-Relay die noch nicht publizierten Events
und verteilt Turnieränderungen über Socket.IO. Der Redis-Adapter hält mehrere
API-Instanzen konsistent.

Clients abonnieren ausschliesslich einen Turnierraum und laden nach einem Event
den autoritativen HTTP-Zustand neu. Öffentliche Live-Endpunkte sind bewusst
schreibgeschützt und geben nur den projizierten Turnierstand zurück.

## Folgen

- WebSockets werden nie zum primären Write-Kanal.
- Unterbrochene Verbindungen führen sichtbar auf HTTP-Polling zurück.
- Zuschauer-, TV- und Board-Ansicht verwenden dieselbe Projektion wie die
  Turnierleitung und können deshalb nicht auseinanderlaufen.
- Outbox-Ereignisse dürfen bei einem Prozessabbruch erneut zugestellt werden;
  Clients behandeln sie als Invalidierung und damit idempotent.
