# Scheiben-Tablet einrichten

Für Vereinsverantwortliche, keine technischen Vorkenntnisse nötig.

Ein an der Scheibe fest montiertes Tablet kann Matches scoren, ohne dass sich
dort jemand anmeldet. Dazu wird es einmal mit der Scheibe gekoppelt. Danach
erkennt es von selbst jedes Match, das dieser Scheibe zugewiesen wird — im
freien Match, im Turnier und im Liga-Spieltag. Wer das Tablet in der Hand
hat, kann damit scoren; alles andere (Turnier verwalten, Spieler anlegen,
Match abbrechen) bleibt gesperrt.

## 1. Was es braucht

- Ein Tablet (iPad oder Android) mit funktionierendem WLAN.
- Ein Benutzerkonto mit Berechtigung «Boards verwalten»: Inhaber, Admin oder
  Turnierleitung der Organisation (Recht `board:manage`).
- Die Scheibe muss in der Plattform bereits als Board angelegt sein.

## 2. App auf dem Tablet installieren

Das Tablet braucht die Plattform als installierte App, nicht nur als
geöffnete Internetseite. Der Grund: iPad und Android trennen den Speicher
einer installierten App von dem eines normalen Browser-Tabs — nur in der
installierten App bleibt die Kopplung über einen Neustart hinweg erhalten.

### iPad (Safari)

1. Die Plattform-Adresse in Safari öffnen.
2. Unten auf das Symbol **Teilen** tippen (Quadrat mit Pfeil nach oben).
3. Im Menü **Zum Home-Bildschirm** wählen.
4. **Hinzufügen** antippen. Auf dem Home-Bildschirm erscheint ein neues
   Symbol.

### Android (Chrome)

1. Die Plattform-Adresse in Chrome öffnen.
2. Oben rechts auf das Menü (drei Punkte) tippen.
3. **App installieren** (oder **Zum Startbildschirm hinzufügen**) wählen.
4. Bestätigen. Auf dem Startbildschirm oder in der App-Übersicht erscheint
   ein neues Symbol.

Die genaue Beschriftung kann je nach Systemversion leicht abweichen; der Weg
über **Teilen** (iPad) beziehungsweise das Menü mit den drei Punkten
(Android) ist auf beiden Plattformen stabil.

## 3. Tablet mit der Scheibe koppeln

1. Das neu installierte App-Symbol auf dem Home-/Startbildschirm öffnen
   (nicht Safari oder Chrome direkt).
2. Mit dem Benutzerkonto anmelden, das Boards verwalten darf.
3. Zur Organisationsseite wechseln und den Abschnitt **Scheiben-Tablets**
   öffnen.
4. Bei der gewünschten Scheibe **Dieses Gerät einrichten** wählen. Der
   Knopf lässt sich nur anklicken, wenn die App tatsächlich installiert
   läuft — im normalen Browser-Tab erscheint stattdessen ein Hinweis, die
   App zuerst zu installieren.
5. Das Tablet meldet die Admin-Sitzung danach selbst ab und wechselt
   automatisch in die Kiosk-Ansicht der Scheibe. Ab jetzt zeigt das Tablet
   den Namen der Scheibe und wartet auf das nächste zugewiesene Match.

Ab diesem Zeitpunkt ist keine weitere Anmeldung an diesem Tablet mehr nötig.

## 4. Tablet gegen fremden Zugriff sperren

Die Kopplung allein hindert niemanden daran, am Tablet in den normalen
Browser oder in andere Apps zu wechseln. Dafür zusätzlich die Sperre des
Betriebssystems aktivieren:

### iPad: Geführter Zugriff

1. **Einstellungen** → **Bedienungshilfen** → **Geführter Zugriff** öffnen
   und aktivieren. Beim ersten Mal einen Code festlegen (separat von einem
   allfälligen Gerätecode notieren).
2. Die installierte App öffnen.
3. Dreimal hintereinander die Seitentaste drücken. Der Geführte Zugriff
   startet; das Tablet lässt sich danach nur noch mit dem festgelegten Code
   oder Face ID / Touch ID verlassen.

### Android: App anheften

1. **Einstellungen** → **Sicherheit** (Bezeichnung je nach Hersteller
   leicht abweichend) öffnen und **App anheften** aktivieren.
2. Die installierte App öffnen, die Übersicht der offenen Apps aufrufen und
   die App über das Symbol **Anheften** fixieren.
3. Zum Lösen: die vom System vorgesehene Geste oder Tastenkombination
   verwenden (je nach Hersteller, zum Beispiel Zurück- und
   Übersicht-Taste gleichzeitig gedrückt halten).

Ein Kiosk-Browser eines Drittanbieters ist ebenfalls möglich, ist aber nicht
Teil dieser Anleitung.

## 5. Tablet ersetzen

Geht ein Tablet kaputt oder verloren, lässt sich die Scheibe ohne Umweg neu
koppeln:

1. Auf einem neuen oder zurückgesetzten Tablet die Schritte 2 und 3 oben
   wiederholen.
2. Bei **Dieses Gerät als Ersatz einrichten** bestätigen. Das bisherige
   Tablet dieser Scheibe wird dabei automatisch entkoppelt — es lässt sich
   nicht mehr zum Scoren verwenden, bis es selbst neu eingerichtet wird.

## 6. Tablet entkoppeln

Wenn ein Tablet endgültig nicht mehr an einer Scheibe eingesetzt werden
soll (zum Beispiel bei einem Umbau oder einem verlorenen Gerät):

1. In der Organisationsverwaltung den Abschnitt **Scheiben-Tablets** öffnen.
2. Bei der betroffenen Scheibe **Entkoppeln** wählen und bestätigen.

Das Tablet verliert den Zugriff sofort. Es zeigt danach die Meldung «Dieses
Tablet ist nicht mehr gekoppelt» und muss gemäss Abschnitt 3 neu eingerichtet
werden, um wieder zu funktionieren.

**Bei Diebstahl oder Verlust:** sofort entkoppeln. Bis zum Entkoppeln kann
mit dem Tablet jedes Match dieser Scheibe gescort werden — alles andere
(Turnier- und Spielerverwaltung, andere Scheiben) bleibt gesperrt.

## 7. «Dieses Tablet ist nicht mehr gekoppelt»

Diese Meldung erscheint, wenn das Tablet entkoppelt wurde oder durch ein
Ersatzgerät abgelöst worden ist (Abschnitt 5 oder 6). Noch nicht
übertragene Aufnahmen aus dem laufenden Match bleiben dabei sichtbar
angezeigt, gehen also nicht unbemerkt verloren.

Vorgehen: das Tablet gemäss Abschnitt 3 neu einrichten. Dafür wird wieder
ein Konto mit Berechtigung «Boards verwalten» benötigt.

## 8. Tablet lokal zurücksetzen

Ein langer Druck auf den Scheibennamen oben in der Kiosk-Ansicht öffnet
«Gerät zurücksetzen?». Das löscht die Kopplung **nur auf diesem Tablet** —
serverseitig bleibt sie gültig, bis sie gemäss Abschnitt 6 entkoppelt oder
gemäss Abschnitt 5 durch ein neues Gerät ersetzt wird. Dieser Weg eignet
sich, um ein Tablet vor einer Weitergabe oder Reparatur lokal zu
bereinigen; er ersetzt das Entkoppeln in der Organisationsverwaltung nicht.

## Bekannte Einschränkung

Ob die Kopplung auf einem iPad über längere Zeit ohne Nutzung (mehrere Tage),
einen Neustart oder ein iOS-Update hinweg zuverlässig erhalten bleibt, wird
im Rahmen der Einführung noch auf einem echten Gerät geprüft (Spec
`docs/superpowers/specs/2026-09-30-scheiben-tablet-design.md`, Abschnitt 7).
Geht die Kopplung unerwartet verloren, hilft Abschnitt 3 (neu einrichten)
zuverlässig weiter — es entsteht dabei kein Datenverlust, da ein Match immer
an der Scheibe (dem Board) hängt, nicht am einzelnen Tablet.
