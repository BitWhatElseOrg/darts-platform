"use client";

import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { type MatchStateResponse } from "@darts-platform/schemas";
import { Button } from "@darts-platform/ui";
import { userFacingErrorMessage } from "@/lib/api-client";
import {
  dartEntryReducer, dartVisitCommand, emptyDartEntry, previewDartEntry, type DartEntryPreview,
} from "@/lib/dart-entry";
import { queuedCommandNotice } from "@/lib/offline-replay";
import {
  appendRoundDigit, checkoutCommandFields, checkoutOutRuleFor, isRoundEntrySubmittable, onlyPossibleDouble,
  removeRoundDigit, requiresDartEntry,
} from "@/lib/round-entry";
import {
  defaultScoreboardSettings, readScoreboardSettings, subscribeScoreboardSettings, writeScoreboardSettings,
} from "@/lib/scoreboard-settings";
import { pendingLegDecision } from "@/lib/scoreboard-view";
import { AbortMatchDialog } from "./abort-match-dialog";
import { LegDecisionDialog } from "./leg-decision-dialog";
import { CheckoutDialog } from "./checkout-dialog";
import { DartKeypad } from "./dart-keypad";
import { RoundKeypad } from "./round-keypad";
import { ScoreboardHeader } from "./scoreboard-header";
import { ScoreboardSettingsDialog } from "./scoreboard-settings-dialog";
import { ScoreboardSides } from "./scoreboard-sides";
import { ScoreboardStatus } from "./scoreboard-status";
import { useMatchScoring } from "./use-match-scoring";
import { useQuickScores } from "./use-quick-scores";
import { VisitConfirmation } from "./visit-confirmation";

/** Eine Seite kann zwei Personen tragen; ihr Name ist beider Name. */
function sideNames(participant: MatchStateResponse["participants"][number]): string {
  return participant.players.map((person) => person.displayName).join(" und ");
}

function winnerName(match: MatchStateResponse): string {
  const side = match.participants.find((participant) =>
    participant.players.some((person) => person.playerId === match.winnerPlayerId),
  );
  return side === undefined ? "" : sideNames(side);
}
const mutationMessage = (error: unknown) => userFacingErrorMessage(error);

export function MatchScoreboard({ backHref, backLabel, canAbort, canScore, match, organizationId }: {
  readonly backHref: string;
  readonly backLabel: string;
  readonly canAbort: boolean;
  readonly canScore: boolean;
  readonly match: MatchStateResponse;
  readonly organizationId: string;
}) {
  const scoring = useMatchScoring({ organizationId, match, canScore });
  const { lock, queued, queueReadError, queueWriteError, queueAcceptedButStuck, online, replaying, mayControl, error } = scoring;
  const settings = useSyncExternalStore(subscribeScoreboardSettings, readScoreboardSettings, () => defaultScoreboardSettings);
  // Im Doppel ist `currentPlayerId` die werfende Person, nicht die erste der
  // Seite. Am Oche steht die Seite mit `isActive`.
  const activeParticipant = match.participants.find((participant) => participant.isActive);
  // Unter Double In laesst sich die Eroeffnungsaufnahme nicht als Rundensumme
  // erfassen — die Punkte vor dem eroeffnenden Doppel sind daraus nicht
  // zaehlbar, die Engine lehnt sie ab (round-entry.ts, `requiresDartEntry`).
  // Fuer genau diese Aufnahme zeigt die Flaeche deshalb das Dart-Keypad, auch
  // wenn der Runden-Modus eingestellt ist; danach kehrt er von selbst zurueck.
  const dartEntryRequired = requiresDartEntry(match, activeParticipant);
  // Reglement 2.2.9 / Anhang 2: steht ein Entscheid aus, nimmt der Server
  // fuer dieses Leg keine Aufnahme an. Die Flaeche sperrt deshalb die Eingabe
  // und verlangt ihn zuerst — nur, wer ohnehin steuern darf, bekommt den
  // Dialog; alle anderen sehen die gesperrte Flaeche.
  const legDecision = mayControl ? pendingLegDecision(match) : null;
  const inputMode = dartEntryRequired ? "DART" : settings.mode;
  const quickScores = useQuickScores({ organizationId, playerId: match.currentPlayerId, enabled: inputMode === "ROUND" });
  const [roundValue, setRoundValue] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutField, setCheckoutField] = useState("");
  const [checkoutDarts, setCheckoutDarts] = useState<1 | 2 | 3>(3);
  const [abortOpen, setAbortOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const checkoutOutRule = checkoutOutRuleFor(match.outRule);
  const [entry, dispatchEntry] = useReducer(dartEntryReducer, emptyDartEntry);
  const [pendingConfirmation, setPendingConfirmation] = useState<DartEntryPreview | null>(null);
  const autoConfirmTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasPending = queued.length > 0;
  // Der Eingabezustand der Fläche gehört der Komponente, das Wissen um Erfolg
  // oder Misserfolg der Mutation dem Hook. Ohne Callback bleibt der
  // Erfolgszähler die einzige Möglichkeit, „gerade erfolgreich übertragen"
  // von „noch nie versucht" zu unterscheiden — angepasst während des Renders
  // (React-Muster für abgeleiteten Zustand), nicht in einem Effect.
  //
  // Dieselbe Stelle setzt auch die Dart-Aufnahme zurück: erst bei
  // tatsächlichem Erfolg der Mutation, nicht sofort nach dem Absenden. Ein
  // Versionskonflikt lässt die geworfenen Darts sonst ausdrücklich stehen
  // (siehe Design-Spec, Randfälle) — ein sofortiges Zurücksetzen würde sie
  // beim Fehlschlag verlieren, obwohl niemand sie neu tippen sollte.
  const [lastSubmitSuccess, setLastSubmitSuccess] = useState(scoring.submitSucceededAt);
  const submitJustSucceeded = lastSubmitSuccess !== scoring.submitSucceededAt;
  if (submitJustSucceeded) {
    setLastSubmitSuccess(scoring.submitSucceededAt);
    setRoundValue("");
    setCheckoutOpen(false);
    setCheckoutField("");
    setCheckoutDarts(3);
    dispatchEntry({ type: "RESET" });
    setPendingConfirmation(null);
  }
  const [lastAbortSuccess, setLastAbortSuccess] = useState(scoring.abortSucceededAt);
  if (lastAbortSuccess !== scoring.abortSucceededAt) {
    setLastAbortSuccess(scoring.abortSucceededAt);
    setAbortOpen(false);
    setSettingsOpen(false);
  }
  const handleRoundDigit = (digit: number) => setRoundValue((current) => appendRoundDigit(current, digit));
  const handleRoundQuickScore = (score: number) => setRoundValue(String(score));
  const handleRoundBackspace = () => {
    if (roundValue === "") {
      scoring.undoVisit();
      return;
    }
    setRoundValue((current) => removeRoundDigit(current));
  };
  // Erzwingt den Checkout-Schritt bei einem Ausgang mit Doppel (alles ausser
  // SINGLE), unabhaengig von "Checkout-Darts bestaetigen": ohne ein
  // erkanntes Checkout-Feld wertet die Engine ein Double-/Master-Out sonst
  // als Bust (x01.ts, closesLeg). `onlyPossibleDouble` presetzt nur ein
  // eindeutiges Doppel; ein eindeutiges Triple unter Master Out bleibt
  // unpresetzt (siehe round-entry.ts, checkoutFieldOptions).
  const handleRoundSubmit = () => {
    if (activeParticipant === undefined) return;
    const visitPoints = Number(roundValue);
    if (visitPoints === activeParticipant.remaining && match.outRule !== "SINGLE") {
      scoring.resetSubmit();
      const preset = onlyPossibleDouble(visitPoints);
      setCheckoutField(preset === null ? "" : String(preset));
      setCheckoutDarts(3);
      setCheckoutOpen(true);
      return;
    }
    scoring.submitVisit({ points: visitPoints, dartsThrown: 3 });
  };
  // Die Einstellung „Checkout-Darts bestaetigen" steuert die Abfrage der
  // Dart-ZAHL, nicht die des Segments: ist sie aus, blendet der Dialog die
  // Dartwahl aus (checkout-dialog.tsx) und die Aufnahme geht mit drei Darts
  // raus. Das Segment bleibt in beiden Faellen noetig, sonst wertet die
  // Engine den Legabschluss unter Double/Master Out als Bust (siehe
  // `handleRoundSubmit`).
  const checkoutDartsThrown: 1 | 2 | 3 = settings.confirmCheckoutDarts ? checkoutDarts : 3;
  // Die gewaehlte Dartzahl im Dialog gilt fuer einen ERFOLGREICHEN Checkout;
  // fuer den Bust ist sie bedeutungslos und darf ihn nicht blockieren
  // (`checkoutDarts` koennte z. B. auf 1 stehen, obwohl 141 Punkte nur mit
  // drei Darts werfbar sind) -- deshalb immer drei Darts.
  const handleCheckoutBust = () => {
    scoring.submitVisit({ points: Number(roundValue), dartsThrown: 3, checkoutMissed: true, checkoutAttempted: true });
  };
  // `checkoutCommandFields` entscheidet ueber das Belegfeld: unter Master Out
  // `checkoutSegment` (Doppel wie Triple), unter Double Out weiterhin
  // `checkoutDouble` (siehe round-entry.ts). `checkoutAttempted` haelt die
  // Checkout-Quote in beiden Faellen korrekt (siehe use-match-scoring.ts).
  const handleCheckoutSubmit = () => {
    scoring.submitVisit({
      checkoutAttempted: true,
      dartsThrown: checkoutDartsThrown,
      points: Number(roundValue),
      ...checkoutCommandFields(checkoutField, checkoutOutRule),
    });
  };

  // Wechselt durch die Serverantwort die werfende Person oder das Leg,
  // gehörte eine angefangene Dart-Aufnahme zu einem vergangenen Zustand und
  // wird verworfen. Angepasst während des Renders (dasselbe Muster wie
  // `lastSubmitSuccess` oben), nicht in einem Effect: reines Zurücksetzen
  // von Zustand anhand veränderter Props gehört laut React nicht in einen
  // Effect (`react-hooks/set-state-in-effect`) — ein Effect wäre hier ein
  // zusätzlicher, unnötiger Render. Bewusst nicht an `match.version`
  // gehängt: ein Versionskonflikt allein lässt die Würfe stehen.
  const turnKey = `${match.currentPlayerId ?? ""}:${match.currentLegNumber}`;
  const [lastTurnKey, setLastTurnKey] = useState(turnKey);
  if (lastTurnKey !== turnKey) {
    setLastTurnKey(turnKey);
    dispatchEntry({ type: "RESET" });
    setPendingConfirmation(null);
    setRoundValue("");
    setCheckoutOpen(false);
  }

  // Ein Moduswechsel verwirft eine angefangene Eingabe genauso wie ein
  // Wechsel der werfenden Person oben: das Runden-Keypad kennt im Dart-Modus
  // erfasste Würfe nicht und würde sie sonst stillschweigend unterschlagen.
  // Unkommitteter Zustand, kein gespeicherter Wurf — das Modal selbst nennt
  // die Konsequenz (scoreboard-settings-dialog.tsx), deshalb kein stiller
  // Verlust im Sinne der Vorgabe.
  //
  // Dasselbe gilt fuer den erzwungenen Wechsel unter Double In: sobald die
  // Seite eroeffnet hat, kehrt der Runden-Modus zurueck, und eine
  // angefangene Eingabe des anderen Keypads gehoerte zum alten Zustand.
  const [lastInputMode, setLastInputMode] = useState(inputMode);
  if (lastInputMode !== inputMode) {
    setLastInputMode(inputMode);
    dispatchEntry({ type: "RESET" });
    setPendingConfirmation(null);
    setRoundValue("");
    setCheckoutOpen(false);
    scoring.resetSubmit();
  }

  // Die Zusammenstellung des Kommandos liegt in `dart-entry.ts` und ist dort
  // gegen `submitVisitSchema` getestet — insbesondere die Frage, welche der
  // beiden Summen `points` traegt (die rohe, nicht die angerechnete).
  const submitEntry = (preview: DartEntryPreview) => {
    const command = dartVisitCommand(entry.darts, preview);
    if (command === null) return;
    scoring.submitVisit(command);
  };

  const confirmPendingVisit = () => {
    if (pendingConfirmation === null || scoring.submitPending) return;
    if (autoConfirmTimeout.current !== null) {
      clearTimeout(autoConfirmTimeout.current);
      autoConfirmTimeout.current = null;
    }
    submitEntry(pendingConfirmation);
  };

  // Vorschau der laufenden Aufnahme — reine Berechnung, jeden Render neu.
  // Reststand und Regeln bleiben für die ganze Aufnahme gleich
  // (VisitContext-Vertrag aus Task 8): `remaining` ist hier immer der Stand
  // VOR der Aufnahme, weil `activeParticipant.remaining` erst durch eine
  // erfolgreich übernommene Serverantwort weiterrückt.
  const completedEntryPreview = activeParticipant === undefined || entry.darts.length === 0
    ? null
    : (() => {
        const preview = previewDartEntry({
          darts: entry.darts,
          remaining: activeParticipant.remaining,
          startingScore: match.startingScore,
          inRule: match.inRule,
          outRule: match.outRule,
        });
        return preview.complete ? preview : null;
      })();

  // Erscheint eine neue abgeschlossene Aufnahme (drittem Wurf, Checkout oder
  // Bust) und ist eine Bestätigung verlangt, wird sie eingeblendet — reines
  // Setzen von Zustand, deshalb während des Renders wie oben, nicht im
  // Effect. Ohne die Einstellung geht die Aufnahme direkt raus; das ruft
  // die Mutation auf und ist ein echter Seiteneffekt, deshalb unten im
  // eigenen Effect statt hier.
  const [previewedDarts, setPreviewedDarts] = useState(entry.darts);
  if (previewedDarts !== entry.darts) {
    setPreviewedDarts(entry.darts);
    if (completedEntryPreview !== null && settings.confirmScore) {
      setPendingConfirmation(completedEntryPreview);
    }
  }

  // Review-Befund 1: schlägt das automatische Senden ohne Bestätigung fehl
  // (Versionskonflikt, 4xx/5xx), bleibt `entry.darts` unverändert stehen —
  // der Effekt unten hängt an `entry.darts` und feuert deshalb nie wieder,
  // und der Reducer verwirft jeden weiteren Tastendruck stumm, weil die
  // Aufnahme schon `complete` ist. Ohne Gegenmassnahme gäbe es dann keinen
  // Weg mehr zum erneuten Absenden ausser Rücktaste-und-neu-Tippen. Sobald
  // ein Sendeversuch endet (pending → nicht mehr pending), OHNE dass er
  // erfolgreich war (sonst hätte der Block oben schon zurückgesetzt), wird
  // dieselbe Bestätigungsfläche als Wiederholungsangebot eingeblendet —
  // `WEITER` versucht denselben Versuch erneut, `‹` lässt die Würfe für die
  // Rücktaste stehen. Im Bestätigungsmodus (`confirmScore`) ist das nicht
  // nötig: dort bleibt die Fläche ohnehin offen, bis `WEITER` gelingt.
  const [lastSubmitPending, setLastSubmitPending] = useState(scoring.submitPending);
  if (lastSubmitPending !== scoring.submitPending) {
    const submitJustSettledWithoutSuccess = lastSubmitPending && !scoring.submitPending && !submitJustSucceeded;
    setLastSubmitPending(scoring.submitPending);
    if (submitJustSettledWithoutSuccess && completedEntryPreview !== null && !settings.confirmScore) {
      setPendingConfirmation(completedEntryPreview);
    }
  }

  // Automatisches Senden ohne Bestätigung: ruft die Mutation auf, sobald
  // eine neue abgeschlossene Aufnahme erscheint. Absichtlich nur an
  // `entry.darts` gehängt, damit ein unveränderter, bereits gesendeter
  // Checkout nicht ein zweites Mal rausgeht.
  useEffect(() => {
    if (completedEntryPreview !== null && !settings.confirmScore) {
      submitEntry(completedEntryPreview);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.darts]);

  // Automatisches Bestätigen: 1200 ms nach dem Einblenden senden, sofern die
  // Bestätigung nicht vorher manuell oder per Tipp auf die Fläche ausgelöst
  // wurde. Das Timeout räumt sich beim Verlassen (Effekt-Cleanup) und beim
  // manuellen Bestätigen (`confirmPendingVisit`) auf.
  useEffect(() => {
    if (pendingConfirmation === null || !settings.autoConfirm) return;
    autoConfirmTimeout.current = setTimeout(() => {
      confirmPendingVisit();
    }, 1200);
    return () => {
      if (autoConfirmTimeout.current !== null) clearTimeout(autoConfirmTimeout.current);
      autoConfirmTimeout.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingConfirmation, settings.autoConfirm]);

  const handleDartSegment = (segment: number) => {
    if (activeParticipant === undefined) return;
    dispatchEntry({
      type: "SEGMENT",
      segment,
      remaining: activeParticipant.remaining,
      startingScore: match.startingScore,
      inRule: match.inRule,
      outRule: match.outRule,
    });
  };

  const handleDartBackspace = () => {
    if (entry.darts.length === 0) {
      scoring.undoVisit();
      return;
    }
    dispatchEntry({ type: "BACKSPACE" });
  };

  return (
    <section aria-label="Match-Scoreboard" className="grid h-[100dvh] grid-rows-[auto_auto_auto_1fr] bg-slate-950 text-white">
      {/* Ohne Seitentitel ist das die einzige Überschrift der Fläche und der
          einzige Name, den Screenreader ausserhalb von "Match-Scoreboard"
          zu hören bekommen. `sr-only` ist `position: absolute` und nimmt
          deshalb keine eigene Grid-Zeile ein. */}
      <h1 className="sr-only">
        {sideNames(match.participants[0])} – {sideNames(match.participants[1])}
      </h1>
      <ScoreboardHeader
        backHref={backHref}
        backLabel={backLabel}
        match={match}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <ScoreboardStatus
        lockState={lock.state}
        message={error !== null && !checkoutOpen ? mutationMessage(error) : null}
        online={online}
        onTakeOver={lock.takeOver}
        queuedCount={queued.length}
      />
      <ScoreboardSides
        match={match}
        pendingDarts={inputMode === "DART" ? entry.darts : []}
        showDartBand={inputMode === "DART"}
      />
      {/* Review-Befund 3: drei feste Reihen statt eines einzigen scrollenden
          Blocks — sonst bekommt das Keypad je nach Inhalt der ersten Reihe
          (Warteschlangen-Banner vorhanden oder nicht) mal die 1fr-Spur, mal
          gar keine. So bleibt seine Reihe unabhängig davon immer die
          mittlere, bekommt also immer den verbleibenden Platz; nur wenn der
          Gesamtinhalt trotzdem nicht passt (z. B. sehr niedriges Gerät),
          scrollt diese Fläche für sich, ohne dass die Seite selbst wächst. */}
      <div className="grid min-h-0 grid-rows-[auto_1fr_auto] overflow-y-auto">
        <div>
          {hasPending || queueReadError !== null || queueWriteError !== null ? (
            <div className="border-b border-amber-400/40 bg-amber-300/10 p-4">
              {/* Auch ein Fehler der Warteschlange selbst gehoert in dieses
                  Band: sonst zeigt die Flaeche eine leere Liste, obwohl
                  Aufnahmen ungesendet in IndexedDB liegen (AGENTS.md §18).
                  Lesen und Schreiben stehen getrennt -- sie bedeuten
                  Unterschiedliches und koennen gleichzeitig zutreffen. */}
              {queueReadError !== null ? (
                <p className="text-body text-amber-100" role="status">{queueReadError}</p>
              ) : null}
              {queueWriteError !== null ? (
                <p className="text-body text-amber-100" role="status">{queueWriteError}</p>
              ) : null}
              {queued.map((command) => {
                // Ob ein Eintrag verworfen werden darf, entscheidet
                // `queuedCommandNotice` -- eintragsbezogen. Bis Runde 7 stand
                // hier zusaetzlich `|| queueWriteError !== null`: der
                // Schreibfehler gilt fuer den ganzen Scope, und ein einziger
                // haengender Eintrag bot damit das Verwerfen fuer JEDE
                // wartende Aufnahme an -- auch fuer eine dahinterstehende, von
                // Hand erfasste und nie gesendete. Ein Klick loeschte sie
                // endgueltig.
                const notice = queuedCommandNotice(command, {
                  online,
                  acceptedButStuck: queueAcceptedButStuck.has(command.commandId),
                });
                return (
                  <div className="flex flex-wrap items-center justify-between gap-3 text-body text-amber-100" key={command.commandId}>
                    <span>{notice.text}</span>
                    {notice.action === "DISCARD" ? (
                      <Button onClick={() => scoring.discardQueued(command.commandId)} variant="outline">Verwerfen und synchronisieren</Button>
                    ) : null}
                    {notice.action === "RETRY" ? (
                      <Button disabled={!online || replaying} onClick={() => scoring.replay()} variant="outline">Jetzt übertragen</Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="min-h-0">
          {match.status === "COMPLETED" ? (
            <div className="border-b border-emerald-400/30 bg-emerald-400/10 p-5 text-center">
              <p className="text-body uppercase tracking-[0.12em] text-emerald-300">Match beendet</p>
              <p className="mt-1 font-numerals text-title font-bold text-white">{winnerName(match)} gewinnt</p>
            </div>
          ) : canScore && inputMode === "DART" ? (
            <div className="relative h-full min-h-0 border-b border-slate-800 p-3">
              {/* Der erzwungene Wechsel wird benannt, nicht bloss vollzogen:
                  sonst steht die zaehlende Person vor einem anderen Keypad,
                  als sie eingestellt hat. Live-Region, weil der Hinweis ohne
                  eigene Handlung erscheint. */}
              {dartEntryRequired && settings.mode === "ROUND" ? (
                <p aria-live="polite" className="mb-3 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-body text-emerald-100" role="status">
                  Double In: die Eröffnungsaufnahme wird Wurf für Wurf erfasst, danach zählt wieder das Ziffernfeld.
                </p>
              ) : null}
              <DartKeypad
                disabled={!mayControl || legDecision !== null || activeParticipant === undefined || pendingConfirmation !== null || scoring.submitPending}
                modifier={entry.modifier}
                onBackspace={handleDartBackspace}
                onModifier={(multiplier) => dispatchEntry({ type: "MODIFIER", multiplier })}
                onSegment={handleDartSegment}
                segmentsLocked={completedEntryPreview !== null}
              />
              {pendingConfirmation !== null ? (
                <VisitConfirmation
                  bust={pendingConfirmation.outcome === "BUST"}
                  onBack={() => setPendingConfirmation(null)}
                  onConfirm={confirmPendingVisit}
                  points={pendingConfirmation.appliedPoints}
                  thrownPoints={pendingConfirmation.points}
                />
              ) : null}
            </div>
          ) : canScore && inputMode === "ROUND" ? (
            // overflow-y-auto: das Keypad braucht mehr Hoehe als das
            // Dart-Keypad und ueberlief sonst sichtbar in "Letzte Aufnahmen".
            <div className="h-full min-h-0 overflow-y-auto border-b border-slate-800 p-3">
              <RoundKeypad
                disabled={!mayControl || legDecision !== null || activeParticipant === undefined || scoring.submitPending || checkoutOpen}
                onBackspace={handleRoundBackspace}
                onDigit={handleRoundDigit}
                onQuickScore={handleRoundQuickScore}
                onSubmit={handleRoundSubmit}
                quickScores={quickScores.scores}
                quickScoresSource={quickScores.source}
                submittable={isRoundEntrySubmittable(roundValue)}
                value={roundValue}
              />
            </div>
          ) : null}
        </div>
        <div>
          <CheckoutDialog
            confirmDarts={settings.confirmCheckoutDarts}
            darts={checkoutDarts}
            error={checkoutOpen && scoring.submitError !== null ? mutationMessage(scoring.submitError) : null}
            field={checkoutField}
            onBust={handleCheckoutBust}
            onCancel={() => { scoring.resetSubmit(); setCheckoutOpen(false); }}
            onDartsChange={setCheckoutDarts}
            onFieldChange={setCheckoutField}
            onSubmit={handleCheckoutSubmit}
            open={checkoutOpen}
            outRule={checkoutOutRule}
            pending={scoring.submitPending}
            points={Number(roundValue)}
          />
          {/* SPIEL BEENDEN laesst das Einstellungs-Modal absichtlich offen
              (native <dialog>s stapeln sich, unsichtbar darunter) -- beide im
              selben Commit zu wechseln liesse ihre Fokus-Rueckgaben
              (use-dialog-focus-return.ts) gegeneinander laufen, mit
              Playwright gemessen. Erst ein Erfolg schliesst beide (siehe
              lastAbortSuccess oben). */}
          <LegDecisionDialog
            decision={legDecision}
            error={scoring.legDecisionError !== null ? mutationMessage(scoring.legDecisionError) : null}
            onDecide={(seat) => {
              if (legDecision === null) return;
              if (legDecision.kind === "LEG_START") scoring.decideLegStart(seat);
              else scoring.decideLegByBull(seat);
            }}
            pending={scoring.legDecisionPending}
            sideNames={[sideNames(match.participants[0]), sideNames(match.participants[1])]}
          />
          <AbortMatchDialog error={scoring.abortError !== null ? mutationMessage(scoring.abortError) : null} onCancel={() => { scoring.resetAbort(); setAbortOpen(false); }} onSubmit={(reason) => scoring.abortMatch(reason)} open={abortOpen} pending={scoring.abortPending} queuedCount={queued.length} />
          <ScoreboardSettingsDialog abortDisabled={!online || lock.state !== "EIGEN" || scoring.abortPending} backHref={backHref} backLabel={backLabel} canAbort={canAbort && match.status === "IN_PROGRESS"} lockState={lock.state} onAbort={() => { scoring.resetAbort(); setAbortOpen(true); }} onChange={(next) => writeScoreboardSettings(next)} onClose={() => setSettingsOpen(false)} onTakeOver={lock.takeOver} open={settingsOpen} settings={settings} visits={match.visits} />
          {/* Rücknahme = schnelle Korrektur beim Zählen, kein Einstellungsvorgang. */}
          {mayControl && match.visits.some((visit) => !visit.reverted) ? (
            <div className="p-4">
              <Button disabled={scoring.undoPending || !online} onClick={() => scoring.undoVisit()} variant="outline">
                Letzte Aufnahme zurücknehmen
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
