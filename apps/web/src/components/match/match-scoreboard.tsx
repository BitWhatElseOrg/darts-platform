"use client";

import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { type MatchStateResponse } from "@darts-platform/schemas";
import { Button, cn } from "@darts-platform/ui";
import { userFacingErrorMessage } from "@/lib/api-client";
import { dartEntryReducer, emptyDartEntry, previewDartEntry, type DartEntryPreview } from "@/lib/dart-entry";
import { appendRoundDigit, isRoundEntrySubmittable, onlyPossibleDouble, removeRoundDigit } from "@/lib/round-entry";
import { defaultScoreboardSettings, readScoreboardSettings, subscribeScoreboardSettings } from "@/lib/scoreboard-settings";
import { CheckoutDialog } from "./checkout-dialog";
import { DartKeypad } from "./dart-keypad";
import { RoundKeypad } from "./round-keypad";
import { ScoreboardHeader } from "./scoreboard-header";
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
  const { lock, queued, online, replaying, mayControl, error } = scoring;
  const settings = useSyncExternalStore(subscribeScoreboardSettings, readScoreboardSettings, () => defaultScoreboardSettings);
  const quickScores = useQuickScores({ organizationId, playerId: match.currentPlayerId, enabled: settings.mode === "ROUND" });
  const [roundValue, setRoundValue] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutDouble, setCheckoutDouble] = useState("");
  const [checkoutDarts, setCheckoutDarts] = useState<1 | 2 | 3>(3);
  const [abortOpen, setAbortOpen] = useState(false);
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
    setCheckoutDouble("");
    setCheckoutDarts(3);
    dispatchEntry({ type: "RESET" });
    setPendingConfirmation(null);
  }
  const [lastAbortSuccess, setLastAbortSuccess] = useState(scoring.abortSucceededAt);
  if (lastAbortSuccess !== scoring.abortSucceededAt) {
    setLastAbortSuccess(scoring.abortSucceededAt);
    setAbortOpen(false);
  }
  // Im Doppel ist `currentPlayerId` die werfende Person, nicht die erste der
  // Seite. Am Oche steht die Seite mit `isActive`.
  const activeParticipant = match.participants.find((participant) => participant.isActive);

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
  // SINGLE), unabhaengig von "Checkout-Darts bestaetigen": ohne
  // `checkoutDouble` wertet die Engine ein Double-/Master-Out sonst als
  // Bust (x01.ts, closesLeg). `onlyPossibleDouble` liefert nur die Vorbelegung.
  const handleRoundSubmit = () => {
    if (activeParticipant === undefined) return;
    const visitPoints = Number(roundValue);
    if (visitPoints === activeParticipant.remaining && match.outRule !== "SINGLE") {
      scoring.resetSubmit();
      const preset = onlyPossibleDouble(visitPoints);
      setCheckoutDouble(preset === null ? "" : String(preset));
      setCheckoutDarts(3);
      setCheckoutOpen(true);
      return;
    }
    scoring.submitVisit({ points: visitPoints, dartsThrown: 3 });
  };
  // Die gewaehlte Dartzahl im Dialog gilt fuer einen ERFOLGREICHEN Checkout;
  // fuer den Bust ist sie bedeutungslos und darf ihn nicht blockieren
  // (`checkoutDarts` koennte z. B. auf 1 stehen, obwohl 141 Punkte nur mit
  // drei Darts werfbar sind) -- deshalb immer drei Darts.
  const handleCheckoutBust = () => {
    scoring.submitVisit({ points: Number(roundValue), dartsThrown: 3, checkoutMissed: true });
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

  const submitEntry = (preview: DartEntryPreview) => {
    scoring.submitVisit({
      points: preview.points,
      dartsThrown: entry.darts.length as 1 | 2 | 3,
      darts: entry.darts,
    });
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
        onOpenSettings={() => {
          // Task 14 verdrahtet das Einstellungs-Modal; der Knopf steht schon,
          // damit die Kopfzeile ab Task 11 vollständig ist.
        }}
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
        pendingDarts={settings.mode === "DART" ? entry.darts : []}
        showDartBand={settings.mode === "DART"}
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
          {hasPending ? (
            <div className="border-b border-amber-400/40 bg-amber-300/10 p-4">
              {queued.map((command) => (
                <div className="flex flex-wrap items-center justify-between gap-3 text-body text-amber-100" key={command.commandId}>
                  <span>{command.label} · {command.status === "CONFLICT" ? command.error : online ? "Wiederholung läuft" : "Offline"}</span>
                  {command.status === "CONFLICT" ? (
                    <Button onClick={() => scoring.discardQueued(command.commandId)} variant="outline">Verwerfen und synchronisieren</Button>
                  ) : (
                    <Button disabled={!online || replaying} onClick={() => scoring.replay()} variant="outline">Jetzt übertragen</Button>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="min-h-0">
          {match.status === "COMPLETED" ? (
            <div className="border-b border-emerald-400/30 bg-emerald-400/10 p-5 text-center">
              <p className="text-body uppercase tracking-[0.12em] text-emerald-300">Match beendet</p>
              <p className="mt-1 font-numerals text-title font-bold text-white">{winnerName(match)} gewinnt</p>
            </div>
          ) : canScore && settings.mode === "DART" ? (
            <div className="relative h-full min-h-0 border-b border-slate-800 p-3">
              <DartKeypad
                disabled={!mayControl || activeParticipant === undefined || pendingConfirmation !== null || scoring.submitPending}
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
                  points={pendingConfirmation.points}
                />
              ) : null}
            </div>
          ) : canScore && settings.mode === "ROUND" ? (
            // overflow-y-auto: das Keypad braucht mehr Hoehe als das
            // Dart-Keypad und ueberlief sonst sichtbar in "Letzte Aufnahmen".
            <div className="h-full min-h-0 overflow-y-auto border-b border-slate-800 p-3">
              <RoundKeypad
                disabled={!mayControl || activeParticipant === undefined || scoring.submitPending || checkoutOpen}
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
            darts={checkoutDarts}
            error={checkoutOpen && scoring.submitError !== null ? mutationMessage(scoring.submitError) : null}
            field={checkoutDouble}
            onBust={handleCheckoutBust}
            onCancel={() => { scoring.resetSubmit(); setCheckoutOpen(false); }}
            onDartsChange={setCheckoutDarts}
            onFieldChange={setCheckoutDouble}
            onSubmit={() => scoring.submitVisit({ points: Number(roundValue), dartsThrown: checkoutDarts, checkoutDouble: Number(checkoutDouble) })}
            open={checkoutOpen}
            pending={scoring.submitPending}
            points={Number(roundValue)}
          />
          <AbortMatchDialog error={scoring.abortError !== null ? mutationMessage(scoring.abortError) : null} onCancel={() => { scoring.resetAbort(); setAbortOpen(false); }} onSubmit={(reason) => scoring.abortMatch(reason)} open={abortOpen} pending={scoring.abortPending} queuedCount={queued.length} />
          <div className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="font-numerals text-title-sm font-bold text-slate-200">Letzte Aufnahmen</h4>
              <div className="flex flex-wrap gap-2">
                {mayControl && match.visits.some((visit) => !visit.reverted) ? <Button disabled={scoring.undoPending || !online} onClick={() => scoring.undoVisit()} variant="outline">Letzte Aufnahme zurücknehmen</Button> : null}
                {canAbort && match.status === "IN_PROGRESS" ? <Button className="border border-rose-500/60 bg-rose-600 text-white hover:bg-rose-500" disabled={!online || lock.state !== "EIGEN" || scoring.abortPending} onClick={() => { scoring.resetAbort(); setAbortOpen(true); }}>Match abbrechen</Button> : null}
              </div>
            </div>
            <div className="mt-3 space-y-2">{match.visits.slice(0, 8).map((visit) => <div className={cn("flex min-h-11 items-center justify-between rounded-lg bg-slate-900 px-3 text-body", visit.reverted && "opacity-40 line-through")} key={visit.id}><span className="text-slate-300">{visit.playerDisplayName} · {visit.dartsThrown} Darts</span><span className="font-bold text-white">{visit.outcome === "BUST" ? `BUST (${visit.points})` : `${visit.appliedPoints} → ${visit.scoreAfter}`}</span></div>)}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AbortMatchDialog({ error, onCancel, onSubmit, open, pending, queuedCount }: {
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onSubmit: (reason: string) => void;
  readonly open: boolean;
  readonly pending: boolean;
  readonly queuedCount: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      setReason("");
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);

  if (!open) return null;
  return (
    <dialog aria-describedby="abort-match-description" aria-labelledby="abort-match-title" className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-rose-500/50 bg-slate-950 p-0 text-white shadow-2xl backdrop:bg-slate-950/80" onCancel={(event) => { event.preventDefault(); onCancel(); }} ref={dialogRef}>
      <form className="space-y-5 p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); onSubmit(reason.trim()); }}>
        <div>
          <h4 className="font-numerals text-title font-bold" id="abort-match-title">Match abbrechen</h4>
          <p className="mt-2 text-body text-slate-300" id="abort-match-description">Alle Aufnahmen und Legs dieses Matches werden unwiderruflich verworfen. {queuedCount} lokal gespeicherte {queuedCount === 1 ? "Aufnahme wird" : "Aufnahmen werden"} verworfen. Das Board wird freigegeben; eine Turnierpaarung wechselt zurück auf READY.</p>
        </div>
        <label className="block space-y-2 text-body font-semibold text-slate-200">
          <span>Abbruchgrund</span>
          <textarea autoFocus className="min-h-24 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-base text-white outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-400/30" maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="z. B. falsche Board-Zuweisung" required value={reason} />
        </label>
        {error ? <p className="text-body text-rose-300" role="alert">{error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Button disabled={pending} onClick={onCancel} type="button" variant="outline">Zurück zum Match</Button>
          <Button className="bg-rose-600 text-white hover:bg-rose-500" disabled={pending || reason.trim().length < 3} type="submit">Match endgültig abbrechen</Button>
        </div>
      </form>
    </dialog>
  );
}
