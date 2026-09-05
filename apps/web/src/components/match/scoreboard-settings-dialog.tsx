"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { MatchStateResponse } from "@darts-platform/schemas";
import { Button, cn } from "@darts-platform/ui";
import type { ScoreboardInputMode, ScoreboardSettings } from "@/lib/scoreboard-settings";
import type { BoardLockState } from "@/lib/use-board-controller-lock";

const modeOptions: readonly { readonly value: ScoreboardInputMode; readonly label: string }[] = [
  { value: "DART", label: "Dart" },
  { value: "ROUND", label: "Runde" },
];

/**
 * Segmentwahl zwischen Dart- und Rundenmodus, als `role="radiogroup"` aus
 * zwei `role="radio"`-Knöpfen. Pfeiltasten verschieben Auswahl UND Fokus in
 * einem Schritt (ARIA-Radiogroup-Muster) — ein blosses `Tab` würde sonst
 * beide Knöpfe einzeln anspringen, ohne dass Pfeiltasten etwas täten.
 */
function InputModeSwitch({ mode, onChange }: {
  readonly mode: ScoreboardInputMode;
  readonly onChange: (mode: ScoreboardInputMode) => void;
}) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const moveTo = (delta: 1 | -1) => {
    const index = modeOptions.findIndex((option) => option.value === mode);
    const nextIndex = (index + delta + modeOptions.length) % modeOptions.length;
    const next = modeOptions[nextIndex];
    if (next === undefined) return;
    onChange(next.value);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div aria-label="Eingabe" className="grid grid-cols-2 gap-2" role="radiogroup">
      {modeOptions.map((option, index) => (
        <button
          aria-checked={mode === option.value}
          aria-label={option.label}
          className={cn(
            "min-h-14 rounded-lg text-title-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400",
            mode === option.value ? "bg-emerald-500 text-slate-950" : "bg-slate-900 text-slate-200 hover:bg-slate-800",
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); moveTo(1); }
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); moveTo(-1); }
          }}
          ref={(element) => { buttonRefs.current[index] = element; }}
          role="radio"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Ein Schalter mit sichtbarem `NEIN`/`JA` — die beiden Marken sind
 * dekorativ (`aria-hidden`), massgeblich für Screenreader ist
 * `aria-checked` zusammen mit dem beschreibenden `aria-label`, das den
 * Namen der Einstellung UND den aktuellen Zustand trägt.
 */
function SettingSwitch({ checked, disabled, label, onToggle }: {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onToggle: () => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={`${label}: ${checked ? "JA" : "NEIN"}`}
      className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg bg-slate-900 px-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 disabled:opacity-40"
      disabled={disabled}
      onClick={onToggle}
      role="switch"
      type="button"
    >
      <span className="text-body font-semibold text-slate-200">{label}</span>
      <span aria-hidden="true" className="flex overflow-hidden rounded-full border border-slate-700 text-label font-bold">
        <span className={cn("px-3 py-1.5", !checked && "bg-slate-100 text-slate-900")}>NEIN</span>
        <span className={cn("px-3 py-1.5", checked && "bg-emerald-500 text-slate-950")}>JA</span>
      </span>
    </button>
  );
}

/**
 * Einstellungs-Modal hinter dem Zahnrad der Kopfzeile (`scoreboard-header.tsx`).
 * `dialog` mit `showModal` — gebaut wie `AbortMatchDialog`/`CheckoutDialog`
 * in `match-scoreboard.tsx`: dieselbe Ref-Mechanik, dasselbe
 * `onCancel`-Abfangen für `Escape`. Der Fokusfang (Tab bleibt im Dialog)
 * kommt nativ von `<dialog>` mit `showModal`; die Fokusrückgabe beim
 * Schliessen dagegen NICHT — dazu unten mehr, direkt am Ref.
 *
 * `lockState` folgt `BoardLockState` aus `use-board-controller-lock.ts`
 * (`EIGEN`/`FREMD`/`WIRD_ÜBERNOMMEN`), nicht dem im Task-Brief erfundenen
 * `UNBEKANNT` — der Hook kennt dieses dritte Wort nicht (siehe
 * `scoreboard-status.tsx`).
 *
 * Trägt bewusst keine Undo-Funktion: „Letzte Aufnahmen" ist hier nur die
 * gelesene Liste (Brief Schritt 2.3, „unverändert übernommen"), die
 * Rücknahme-Taste bleibt in `match-scoreboard.tsx` sichtbar neben dem
 * Keypad — Rücknehmen ist eine schnelle Korrektur während des Zählens,
 * kein Einstellungsvorgang, und soll nicht hinter einem Modal verschwinden.
 */
export function ScoreboardSettingsDialog({
  backHref,
  backLabel,
  canAbort,
  lockState,
  onAbort,
  onChange,
  onClose,
  onTakeOver,
  open,
  settings,
  visits,
}: {
  readonly open: boolean;
  readonly settings: ScoreboardSettings;
  readonly onChange: (settings: ScoreboardSettings) => void;
  readonly onClose: () => void;
  readonly visits: MatchStateResponse["visits"];
  readonly lockState: BoardLockState;
  readonly onTakeOver: () => void;
  readonly backHref: string;
  readonly backLabel: string;
  readonly canAbort: boolean;
  readonly onAbort: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Anders als bei `AbortMatchDialog`/`CheckoutDialog` bleibt dieses <dialog>
  // IMMER gerendert (kein `if (!open) return null`): mit Playwright
  // verifiziert, dass ein `return null` bei `!open` den nativen Knoten aus
  // dem DOM entfernt, bevor der folgende Effekt ihn ueber `dialogRef.current`
  // noch erreichen kann (der Ref ist zu dem Zeitpunkt schon `null`) — die
  // Fokusrückgabe beim Schliessen lief dadurch nie. Ein ungeöffnetes
  // <dialog> ist ohnehin unsichtbar und für Screenreader nicht erreichbar
  // (UA-Stylesheet `display: none` ohne `[open]`), das Fruehausblenden war
  // also nie fuer die Sichtbarkeit noetig.
  //
  // Ebenso mit Playwright verifiziert: Chromium schliesst das native
  // <dialog> bei Escape SOFORT, bevor `onCancel`s `event.preventDefault()`
  // etwas dagegen ausrichten könnte — ein Vergleich mit `dialog.open` taugt
  // deshalb nicht als Bedingung fürs Zurückholen, das native Element ist zu
  // dem Zeitpunkt oft schon geschlossen. Dieser Ref hält deshalb unabhängig
  // davon fest, wer beim Öffnen fokussiert war, und holt den Fokus bei
  // jedem Wechsel von offen auf geschlossen explizit dorthin zurück.
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    if (open && !dialog.open) {
      previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open) {
      if (dialog.open) dialog.close();
      previouslyFocused.current?.focus();
      previouslyFocused.current = null;
    }
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  return (
    <dialog
      aria-labelledby="scoreboard-settings-title"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-slate-800 bg-slate-950 p-0 text-white shadow-2xl backdrop:bg-slate-950/80"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      ref={dialogRef}
    >
      <div className="max-h-[85vh] space-y-6 overflow-y-auto p-5 sm:p-6">
        <h4 className="font-numerals text-title font-bold" id="scoreboard-settings-title">Einstellungen</h4>

        <section aria-labelledby="scoreboard-settings-mode-title" className="space-y-3">
          <h5 className="text-label font-bold uppercase tracking-[0.12em] text-slate-400" id="scoreboard-settings-mode-title">
            Eingabe
          </h5>
          <InputModeSwitch mode={settings.mode} onChange={(mode) => onChange({ ...settings, mode })} />
          {settings.mode === "DART" ? (
            <div className="space-y-2">
              <SettingSwitch
                checked={settings.confirmScore}
                label="Punktzahl bestätigen"
                onToggle={() => onChange({ ...settings, confirmScore: !settings.confirmScore })}
              />
              <SettingSwitch
                checked={settings.autoConfirm}
                disabled={!settings.confirmScore}
                label="automatisch bestätigen"
                onToggle={() => onChange({ ...settings, autoConfirm: !settings.autoConfirm })}
              />
            </div>
          ) : (
            <SettingSwitch
              checked={settings.confirmCheckoutDarts}
              label="Checkout-Darts bestätigen"
              onToggle={() => onChange({ ...settings, confirmCheckoutDarts: !settings.confirmCheckoutDarts })}
            />
          )}
        </section>

        <section aria-labelledby="scoreboard-settings-visits-title" className="space-y-2">
          <h5 className="text-label font-bold uppercase tracking-[0.12em] text-slate-400" id="scoreboard-settings-visits-title">
            Letzte Aufnahmen
          </h5>
          {visits.length === 0 ? (
            <p className="text-body text-slate-400">Noch keine Aufnahme.</p>
          ) : (
            <div className="space-y-2">
              {visits.slice(0, 8).map((visit) => (
                <div
                  className={cn(
                    "flex min-h-11 items-center justify-between rounded-lg bg-slate-900 px-3 text-body",
                    visit.reverted && "opacity-40 line-through",
                  )}
                  key={visit.id}
                >
                  <span className="text-slate-300">{visit.playerDisplayName} · {visit.dartsThrown} Darts</span>
                  <span className="font-bold text-white">
                    {visit.outcome === "BUST" ? `BUST (${visit.points})` : `${visit.appliedPoints} → ${visit.scoreAfter}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {lockState === "FREMD" ? (
          <Button aria-label="Steuerung übernehmen" onClick={onTakeOver} variant="outline">
            Steuerung übernehmen
          </Button>
        ) : null}

        <Link className="block text-body font-semibold text-emerald-300 underline-offset-4 hover:underline" href={backHref}>
          {backLabel}
        </Link>

        <div className="grid gap-3 sm:grid-cols-2">
          <Button aria-label="Spiel fortsetzen" onClick={onClose}>SPIEL FORTSETZEN</Button>
          {canAbort ? (
            <Button
              aria-label="Spiel beenden"
              className="border border-rose-500/60 bg-rose-600 text-white hover:bg-rose-500"
              onClick={onAbort}
            >
              SPIEL BEENDEN
            </Button>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
