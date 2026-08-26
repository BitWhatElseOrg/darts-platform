# ADR 0009: Reproduzierbare Spielerstatistiken und asynchrone Aggregate

## Status

Akzeptiert – 26. August 2026

## Entscheid

Statistikformeln leben im infrastrukturlosen Paket `packages/statistics` und
arbeiten ausschliesslich auf normalisierten Match-, Leg- und Visit-Daten. Die
API baut Profile aus dem autoritativen Datenbestand; ein separater Worker
berechnet nach `MATCH_COMPLETED` zusätzlich persistente Karriereaggregate.

Die Checkout-Quote verwendet explizit erfasste Doppelversuche. Ein erfolgreicher
Checkout allein ist kein zulässiger Nenner. Checkout-Versuche sind deshalb Teil
des idempotenten Score-Commands und werden mit dem Visit persistiert.

Outbox-Ereignisse besitzen für Realtime und Statistik getrennte
Verarbeitungszeitpunkte. Ein Consumer darf die Zustellung des anderen nicht
verschlucken.

## Folgen

- Alle Kennzahlen sind aus den Rohdaten reproduzierbar und testbar.
- Reverts werden aus Statistiken ausgeschlossen.
- Profile und Head-to-Head bleiben tenant-sicher.
- Worker-Aggregate beschleunigen spätere Rankings, sind aber nie die einzige
  Wahrheit; Match-, Leg- und Visit-Daten bleiben führend.
