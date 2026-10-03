# ADR 0007: Erweiterte Turnierformate als infrastrukturfrei geprüfte Stages

## Status

Akzeptiert – 26. August 2026

## Entscheid

Die Turnier-Engine modelliert erweiterte Formate als geordnete, validierte
Stage-Komposition. Double-Elimination-Abhängigkeiten, Schweizer Paarungen,
Setzung sowie Team- und Paar-Invarianten bleiben reine TypeScript-Domainlogik.
Die API projiziert daraus eine serverseitig geprüfte Formatvorschau; React
berechnet keine Matchgraphen.

Sets sind eine Regel des X01-Aggregats. Die Datenbank persistiert
`legs_to_win_set` und `sets_to_win`, damit ein laufendes Match nach einem
Neustart mit exakt denselben Regeln rekonstruiert wird.

## Folgen

- Stage-Schlüssel, Qualifikationen und Teilnehmerzugehörigkeiten werden vor der
  Verwendung validiert.
- Schweizer Paarungen bevorzugen Gegner, die noch nicht gegeneinander gespielt
  haben; ein Bye wird von unten in der Rangliste und höchstens einmal vergeben.
- Double Elimination enthält ausschliesslich topologisch gültige Winner- und
  Loser-Abhängigkeiten.
- Formatkonfiguration und Scoring-Regeln bleiben unabhängig von der UI.

## Nachtrag 03.10.2026

Doppel-K.-o. ist seit ADR 0022 spielbar. `generateDoubleElimination` in
`advanced.ts` ist überholt und wird mit Plan 2 (Swiss) entfernt.
