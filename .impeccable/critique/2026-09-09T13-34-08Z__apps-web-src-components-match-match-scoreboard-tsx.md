---
target: Scoringflaeche Boardgeraet + JA/NEIN-Pillen
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-09-09T13-34-08Z
slug: apps-web-src-components-match-match-scoreboard-tsx
---
Method: dual-agent (A: Design-Review, B: Detector- und Browser-Evidenz), beide isoliert.

# UX-Test: Scoringflaeche des Boardgeraets + JA/NEIN-Pillen

## Design Health Score

| # | Heuristik | Wert | Kernbefund |
|---|---|---|---|
| 1 | Sichtbarkeit des Systemzustands | 2 | `undoPending` ohne Konsumenten seit Commit 1c51ea1; Offline/Queue/Lock vorbildlich |
| 2 | Uebereinstimmung mit der realen Welt | 3 | Fachsprache konsequent; `0` = Fehlwurf vs. Ziffer 0 je Modus |
| 3 | Nutzerkontrolle und Freiheit | 2 | Ruecknahme nur ueber unbeschrifteten Chevron, Position je Modus verschieden |
| 4 | Konsistenz und Standards | 2 | Zwei handgebaute JA/NEIN-Schalter (Aus-Zustand 16,3:1 vs. 1,2:1); Abbruch in roher rose-Palette |
| 5 | Fehlervermeidung | 2 | Offline-Sperre der Ruecknahme weggefallen; SPIEL BEENDEN in der Daumenzone |
| 6 | Wiedererkennen statt Erinnern | 2 | Doppelbelegung nur in der Anleitung, dort fuer den falschen Modus |
| 7 | Flexibilitaet und Effizienz | 3 | Schnellwerte mit Herkunft, zwei Eingabearten, Auto-Bestaetigung; keine Tastenkuerzel |
| 8 | Aesthetik und Reduktion | 2 | 820px: Zifferntasten 199px hoch bei 18px Schrift; Marken kleben links |
| 9 | Fehler erkennen und beheben | 2 | 409-Behandlung stark; Undo- und Submit-Fehler teilen eine Zeile |
| 10 | Hilfe und Dokumentation | 2 | Anleitung verlinkt, aber an der neuen Stelle falsch |
| **Total** | | **22/40** | **Acceptable** |

B entkraeftete mehrere Verdachtsfaelle von A: kein Ziel unter 44px (kleinste 44x44), kein Textkontrast unter 4,5:1, kein Element ohne sichtbaren Fokus, Fokusringe rendern faktisch identisch (rgb(52,211,153)).

## Design-Specificity-Verdikt

Zustandsschicht authored (Offline-Queue mit eintragsbezogenem Verwerfen, 409 laesst Darts stehen, Double-In-Ausnahme benannt, Oche Rule dreikanalig). Eingabeschicht austauschbar: 101 rohe Tailwind-Palettenklassen gegen 25 Sektorenring-Token in neun Dateien; match-scoreboard.tsx, scoreboard-header.tsx, scoreboard-status.tsx ohne jedes Token trotz `className="sektorenring"`. Kein Control, Wedge oder Rule im Keypad.

Deterministischer Scan: 1 Finding, `gray-on-color` in scoreboard-sides.tsx:51 - False Positive (Ternaer, beide Zweige als ein Klassenstring gelesen; gemessen 14,2:1 aktiv / 7,0:1 inaktiv). share-panel.tsx clean.

Overlay-Injektion nicht erzeugt: kein steuerbarer Browser in der Session, nur Playwright headless. Statt Overlay neun echte Screenshots und Messwerte.

## Was funktioniert

1. Konfliktbehandlung als gelebtes Produktprinzip: `queuedCommandNotice` entscheidet pro Eintrag ueber Verwerfen; beim 409 bleiben die geworfenen Darts stehen und die Bestaetigungsflaeche wird zum Wiederholungsangebot.
2. Trefferflaechen sauber: 56px je Keypad-Taste, 44px Kopfzeile und Dialogknoepfe, kein Ausreisser in vier gemessenen Kombinationen.
3. JA/NEIN-Pillen messbar symmetrisch: 56,41/56,41px (Modal), 53,20/53,20px (Freigabe), Delta 0,00.

## Priority Issues

**[P1] Ruecknahme ohne Schutzmechanismen.** Der entfernte Knopf trug `disabled={undoPending || !online}` und erschien nur bei ruecknehmbarer Aufnahme. Die Ruecktaste hat nichts davon; offline feuert sie eine nicht gequeuete Mutation, `undoPending` ist unkonsumiert, die Taste ist unbeschriftet und sitzt im Dart-Modus oben rechts, im Runden-Modus unten links. Fix: zweite sichtbare Identitaet bei leerer Eingabe, !online-Sperre zurueck, undoPending anzeigen, Docstring und Anleitungszeile korrigieren. -> /impeccable harden, /impeccable clarify

**[P1] 360x640: Aktionszeile hinter einem Innenscroll.** Gemessen Unterkante 721px (Runde) bzw. 687px (Dart, DOUBLE/TRIPLE 9 von 56px sichtbar) bei 640px Viewport; nach scrollIntoView vollstaendig sichtbar, also erreichbar, aber nur mit Scrollen im Keypad. Fix: Aktionszeile aus dem Scrollbereich (sticky/eigene Grid-Zeile), leere Wertanzeige von text-display auf auto (spart ~40px, behebt 2,7:1 des Platzhalters), ScoreboardSides unter ~700px verdichten. -> /impeccable adapt

**[P1] SPIEL BEENDEN in der bequemsten Zone.** Der entfernte Zurueck-Link raeumte die unterste Modalzeile; der Abbruch ist am Telefon jetzt der erreichbarste Knopf, gefuellt und gleich gross wie SPIEL FORTSETZEN (zwei konkurrierende go-Gewichte). Zusaetzlich rohe rose-Palette. Fix: Reihenfolge unter sm umdrehen, Rendition herabsetzen oder destruktive Disclosure. -> /impeccable harden

**[P2] Trenner ohne Wirkung.** border-slate-800 auf slate-950 ~1,4:1, bei 390/360px nicht wahrnehmbar. Fix: Rule tone="ink" (#475569), Caption an den Tastenblock binden. -> /impeccable layout

**[P2] Marken kleben am linken Tastenrand.** Gemessen 0px links / 96,7px rechts (390px), 240px rechts (820px); Ursache Preflight `svg{display:block}` ohne flex-Zentrierung. Fix: inline-flex items-center justify-center in keyClassName. -> /impeccable polish

## Persona-Red-Flags

- Scorer am Board: destruktivste Alltagsfunktion im Standardmodus oben rechts; Bust im Runden-Modus ohne Wort; LEG/RUNDE auf 10px.
- Turnierleitung am Tablet: kein Tablet-Layout (199px Tasten bei 18px Schrift); Freigabe-Schalter markiert NEIN nur ueber 1,22:1 Grunddelta.
- Sam: Ruecktaste heisst nur "Ruecktaste" und verraet die destruktive Zweitbedeutung nicht, keine Live-Ansage nach der Ruecknahme; Tab-Reihenfolge im Dart-Modus zerschnitten (Aktionstaste nach jedem vierten Segment, DOUBLE/TRIPLE erst ab Schritt 28).

## Kleinere Beobachtungen

- Namenschip der aktiven Seite kuerzt, inaktive Seite nicht.
- Segmentraster: Loch unten rechts; 0/25/50 typografisch nicht von Segmentwerten unterscheidbar.
- Drei Gruentoene fuer "primaer" in einem Modal.
- Fokusring gegen die Fuellung des Absendeknopfs 2,85:1 (Schwelle 3:1).
- tracking-[0.08em] als vierter, nicht sanktionierter Trackingwert (round-keypad.tsx:81, share-panel.tsx:128).
- cn() verschluckt das bare focus-visible:outline; ohne Folge, weil outline-2 die Linienart mitsetzt.
- Keine der beiden Pillen traegt eine gezeichnete Marke (Never-Only-Colour Rule); im Freigabe-Panel rettet der StateTag die Information.

## Fragen

1. Hat der Commit die Zahl der Ausstiege gesenkt oder die Zahl der Knoepfe?
2. Zwei gleichrangige Primaernutzer laut PRODUCT.md - beschreibt das der git grep auch so?
3. Ist ein stiller Bust im Runden-Modus ein Verlust im Sinne von "kein stiller Datenverlust"?
