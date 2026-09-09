"use client";

import { useRef } from "react";
import type { MatchStateResponse } from "@darts-platform/schemas";
import { cn, Control, MarkCheck, Rule } from "@darts-platform/ui";
import type { ScoreboardInputMode, ScoreboardSettings } from "@/lib/scoreboard-settings";
import type { BoardLockState } from "@/lib/use-board-controller-lock";
import { useDialogFocusReturn } from "./use-dialog-focus-return";

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
            "min-h-14 rounded-lg text-title-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green",
            mode === option.value ? "bg-ring-green text-chalk" : "bg-sisal-100 text-spider hover:bg-wedge-900",
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
      className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg bg-sisal-100 px-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green disabled:opacity-40"
      disabled={disabled}
      onClick={onToggle}
      role="switch"
      type="button"
    >
      <span className="text-body font-semibold text-spider">{label}</span>
      {/* grid-cols-2 statt flex: als Flex-Elemente wurden die beiden Marken
          so breit wie ihr eigener Text, "NEIN" also deutlich breiter als
          "JA". Zwei 1fr-Spalten sind beide so breit wie die breitere Marke.
          Die gewählte Hälfte trägt zusätzlich ein gezeichnetes Häkchen: die
          Never-Only-Colour Rule verlangt Marke UND Wort, und der Zustand
          hing hier allein daran, welche Hälfte gefüllt ist. */}
      <span aria-hidden="true" className="grid grid-cols-2 overflow-hidden rounded-full border border-sisal-300 text-label font-bold">
        <span className={cn("inline-flex items-center justify-center gap-1 px-3 py-1.5", !checked && "bg-chalk text-sisal-200")}>
          {!checked ? <MarkCheck className="h-3 w-3" /> : null}
          NEIN
        </span>
        <span className={cn("inline-flex items-center justify-center gap-1 px-3 py-1.5", checked && "bg-ring-green text-chalk")}>
          {checked ? <MarkCheck className="h-3 w-3" /> : null}
          JA
        </span>
      </span>
    </button>
  );
}

/**
 * Einstellungs-Modal hinter dem Zahnrad der Kopfzeile (`scoreboard-header.tsx`).
 * Fokusfang und -rückgabe kommen aus `use-dialog-focus-return.ts`.
 *
 * `lockState` folgt `BoardLockState` aus `use-board-controller-lock.ts`
 * (`EIGEN`/`FREMD`/`WIRD_ÜBERNOMMEN`), nicht dem im Task-Brief erfundenen
 * `UNBEKANNT` — der Hook kennt dieses dritte Wort nicht (siehe
 * `scoreboard-status.tsx`).
 *
 * Trägt bewusst keine Undo-Funktion: „Letzte Aufnahmen" ist hier nur die
 * gelesene Liste. Die Rücknahme liegt auf der Rücktaste des Keypads, die bei
 * leerer Eingabe die letzte gesendete Aufnahme trifft und dafür eine eigene
 * sichtbare Identität bekommt (`backspace-key.tsx`) — eine schnelle
 * Korrektur während des Zählens, kein Einstellungsvorgang.
 */
export function ScoreboardSettingsDialog({
  abortDisabled,
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
  readonly canAbort: boolean;
  readonly onAbort: () => void;
  // Dieselbe Sperre, die der Abbrechen-Knopf vor Task 14 direkt trug
  // (`!online || lock.state !== "EIGEN" || scoring.abortPending`) — sonst
  // liesse „SPIEL BEENDEN" sich antippen, obwohl der Abbruch serverseitig
  // ohnehin nichts bewirken würde (Review-Befund 4).
  readonly abortDisabled: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogFocusReturn(dialogRef, open);

  return (
    <dialog
      aria-labelledby="scoreboard-settings-title"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-sisal-300 bg-sisal-200 p-0 text-chalk shadow-2xl backdrop:bg-sisal-200/80"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      ref={dialogRef}
    >
      <div className="max-h-[85vh] space-y-6 overflow-y-auto p-5 sm:p-6">
        <h4 className="font-numerals text-title font-bold" id="scoreboard-settings-title">Einstellungen</h4>

        <section aria-labelledby="scoreboard-settings-mode-title" className="space-y-3">
          <h5 className="text-label font-bold uppercase tracking-[0.12em] text-spider-dim" id="scoreboard-settings-mode-title">
            Eingabe
          </h5>
          <InputModeSwitch mode={settings.mode} onChange={(mode) => onChange({ ...settings, mode })} />
          <p className="text-caption text-spider-dim">Ein Moduswechsel verwirft eine angefangene, noch nicht gesendete Aufnahme.</p>
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
            <div className="space-y-2">
              <SettingSwitch
                checked={settings.confirmCheckoutDarts}
                label="Checkout-Darts bestätigen"
                onToggle={() => onChange({ ...settings, confirmCheckoutDarts: !settings.confirmCheckoutDarts })}
              />
              <p className="text-caption text-spider-dim">
                Aus: der Checkout-Schritt fragt nur nach dem getroffenen Feld und wertet drei Darts.
              </p>
            </div>
          )}
        </section>

        <section aria-labelledby="scoreboard-settings-visits-title" className="space-y-2">
          <h5 className="text-label font-bold uppercase tracking-[0.12em] text-spider-dim" id="scoreboard-settings-visits-title">
            Letzte Aufnahmen
          </h5>
          {visits.length === 0 ? (
            <p className="text-body text-spider-dim">Noch keine Aufnahme.</p>
          ) : (
            <div className="space-y-2">
              {visits.slice(0, 8).map((visit) => (
                <div
                  className={cn(
                    "flex min-h-11 items-center justify-between rounded-lg bg-sisal-100 px-3 text-body",
                    visit.reverted && "opacity-40 line-through",
                  )}
                  key={visit.id}
                >
                  <span className="text-spider">{visit.playerDisplayName} · {visit.dartsThrown} Darts</span>
                  <span className="font-bold text-chalk">
                    {visit.outcome === "BUST" ? `BUST (${visit.points})` : `${visit.appliedPoints} → ${visit.scoreAfter}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {lockState === "FREMD" ? (
          <Control aria-label="Steuerung übernehmen" onClick={onTakeOver} variant="wireInk">
            Steuerung übernehmen
          </Control>
        ) : null}

        {/* Reihenfolge und Gewicht sind hier Fehlervermeidung, nicht Geschmack:
            das Modal wird geöffnet, um die Eingabeart zu wechseln, und der
            unterste Knopf ist am Telefon der mit dem geringsten
            Daumenwiderstand. Der Abbruch stand dort, seit der „Zurück"-Link
            aus dieser Zeile verschwunden ist. Er steht jetzt oberhalb, in der
            leiseren `tight`-Dichte (Zielhöhe bleibt 2,75 rem), und die
            fortsetzende Handlung schliesst die Reihe ab — sie ist die
            erwartete. Beide Renditionen kommen aus `Control`; das frühere
            `bg-ring-red` war rohe Palette auf einer `.sektorenring`-Fläche. */}
        <div className="grid gap-3">
          {canAbort ? (
            <>
              <Rule tone="faint" />
              <Control
                aria-label="Spiel beenden"
                density="tight"
                disabled={abortDisabled}
                onClick={onAbort}
                variant="danger"
              >
                SPIEL BEENDEN
              </Control>
            </>
          ) : null}
          <Control aria-label="Spiel fortsetzen" onClick={onClose} variant="go">SPIEL FORTSETZEN</Control>
        </div>
      </div>
    </dialog>
  );
}
