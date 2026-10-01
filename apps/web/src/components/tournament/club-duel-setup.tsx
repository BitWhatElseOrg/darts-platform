"use client";

import type { ClubDuelPreviewResponse, PlayerResponse } from "@darts-platform/schemas";
import { cn, Control, Field, MarkCheck, Rule, SelectInput, SheetLabel, StateTag, TextInput, Wedge } from "@darts-platform/ui";
import { useRef, useState, type ReactNode } from "react";
import type { UseFormRegister } from "react-hook-form";

import { GuestPlayersPanel } from "@/components/players/guest-players-panel";
import type { SetupFormValues } from "./setup-form-values";

type Errors = Readonly<Record<string, string>>;

/** Abschnitt 2 eines Vereinsduells: die Namen beider Vereine. */
export function ClubSidesSection({ errors, register }: {
  readonly errors: Errors;
  readonly register: UseFormRegister<SetupFormValues>;
}) {
  return (
    <section aria-labelledby="setup-clubs">
      <SheetLabel as="h2" id="setup-clubs">2 · Vereine</SheetLabel>
      <Rule className="mt-2" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field error={errors.sideAName ?? null} htmlFor="sideAName" label="Eigener Verein">
          <TextInput
            aria-describedby={errors.sideAName ? "sideAName-error" : undefined}
            id="sideAName"
            {...register("sideAName")}
          />
        </Field>
        <Field error={errors.sideBName ?? null} htmlFor="sideBName" label="Gastverein">
          <TextInput
            aria-describedby={errors.sideBName ? "sideBName-error" : undefined}
            id="sideBName"
            placeholder="DC Musterdorf"
            {...register("sideBName")}
          />
        </Field>
      </div>
    </section>
  );
}

type Side = "A" | "B";

/**
 * Wählt unter `lg` die sichtbare Spielerspalte, Muster `InputModeSwitch`
 * (scoreboard-settings-dialog.tsx): Radiogroup, Pfeiltasten verschieben
 * Auswahl und Fokus in einem Schritt.
 */
function SideSwitch({ labels, onChange, side }: {
  readonly labels: Readonly<Record<Side, string>>;
  readonly side: Side;
  readonly onChange: (side: Side) => void;
}) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const options: readonly Side[] = ["A", "B"];
  const moveTo = (delta: 1 | -1) => {
    const index = options.indexOf(side);
    const nextIndex = (index + delta + options.length) % options.length;
    const next = options[nextIndex];
    if (next === undefined) return;
    onChange(next);
    buttonRefs.current[nextIndex]?.focus();
  };
  return (
    <div aria-label="Spielerspalte" className="mt-4 grid grid-cols-2 gap-2 lg:hidden" role="radiogroup">
      {options.map((option, index) => {
        const checked = side === option;
        return (
          <button
            aria-checked={checked}
            className={cn(
              "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg px-3 font-plate text-body font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green",
              checked ? "bg-ring-green text-chalk" : "bg-sisal-100 text-spider hover:bg-wedge-800",
            )}
            key={option}
            onClick={() => onChange(option)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); moveTo(1); }
              if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); moveTo(-1); }
            }}
            ref={(element) => { buttonRefs.current[index] = element; }}
            role="radio"
            tabIndex={checked ? 0 : -1}
            type="button"
          >
            {checked ? <MarkCheck className="h-3 w-3 shrink-0" /> : null}
            <span className="truncate">{labels[option]}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Abschnitt 3: zwei Spalten A | B. Unter `lg` zeigt ein Umschalter je eine
 * Spalte (die andere trägt `hidden lg:…`, bleibt also gemountet und SSR-stabil
 * ohne Media-Query in JS); ab `lg` stehen beide nebeneinander. Links die
 * Mitglieder, rechts die Gäste – zuerst die des eingetragenen Gastvereins
 * und alle bereits ausgewählten, die übrigen ausklappbar. Ohne Gastverein-Namen stehen alle Gäste rechts.
 * Neue Gäste landen über `onGuestsCreated` sofort in der Auswahl.
 */
export function ClubParticipantsSection({
  error,
  guests,
  members,
  onGuestsCreated,
  onSelectAllA,
  onToggle,
  organizationId,
  sideAIds,
  sideAName,
  sideBIds,
  sideBName,
}: {
  readonly error: string | null;
  readonly members: readonly PlayerResponse[];
  readonly guests: readonly PlayerResponse[];
  readonly organizationId: string;
  readonly sideAName: string;
  readonly sideBName: string;
  readonly sideAIds: readonly string[];
  readonly sideBIds: readonly string[];
  readonly onToggle: (side: "A" | "B", playerId: string) => void;
  /** «Alle»/«Keinen» für Spalte A: setzt die Mitglieder-Auswahl als Ganzes. */
  readonly onSelectAllA: (playerIds: readonly string[]) => void;
  readonly onGuestsCreated: (players: readonly PlayerResponse[]) => void;
}) {
  const club = sideBName.trim().toLowerCase();
  // Ausgewählte Gäste stehen immer in der Hauptspalte, auch wenn ihr Verein
  // anders heisst: sonst verschwände eine Auswahl im zugeklappten Bereich.
  const mainGuests = club === ""
    ? guests
    : guests.filter((guest) =>
      (guest.guestClubName ?? "").trim().toLowerCase() === club || sideBIds.includes(guest.id));
  const otherGuests = guests.filter((guest) => !mainGuests.includes(guest));
  const describedBy = error !== null ? "participants-error" : undefined;
  const allMembersSelected = members.length > 0 && members.every((member) => sideAIds.includes(member.id));
  const [visibleSide, setVisibleSide] = useState<Side>("A");
  const sideALabel = sideAName.trim() || "Verein A";
  const sideBLabel = sideBName.trim() || "Gastverein";
  return (
    <section aria-labelledby="setup-club-participants">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <SheetLabel as="h2" id="setup-club-participants">3 · Spieler</SheetLabel>
        <span
          aria-label={`${sideAIds.length} gegen ${sideBIds.length} Spieler`}
          className="font-numerals text-counter font-bold tabular text-wedge-900"
        >
          {sideAIds.length} : {sideBIds.length}
        </span>
      </div>
      <Rule className="mt-2" />
      {error !== null ? (
        <p className="mt-2 font-plate text-caption text-ring-red-deep" id="participants-error" role="alert">
          {error}
        </p>
      ) : null}
      <SideSwitch labels={{ A: sideALabel, B: sideBLabel }} onChange={setVisibleSide} side={visibleSide} />
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div className={cn("min-w-0", visibleSide !== "A" && "hidden lg:block")} data-side="A">
          <PlayerColumn
            action={members.length > 0 ? (
              <Control
                density="tight"
                onClick={() => onSelectAllA(allMembersSelected ? [] : members.map((member) => member.id))}
                variant="wire"
              >
                {allMembersSelected ? "Keinen" : "Alle"}
              </Control>
            ) : null}
            describedBy={describedBy}
            heading={`Spieler ${sideALabel}`}
            onToggle={(playerId) => onToggle("A", playerId)}
            players={members}
            selected={sideAIds}
          />
        </div>
        <div className={cn("flex min-w-0 flex-col gap-4", visibleSide !== "B" && "hidden lg:flex")} data-side="B">
          <PlayerColumn
            describedBy={describedBy}
            heading={`Spieler ${sideBLabel}`}
            onToggle={(playerId) => onToggle("B", playerId)}
            players={mainGuests}
            selected={sideBIds}
          />
          {otherGuests.length > 0 ? (
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center font-plate text-caption text-sisal-500">
                Weitere Gastspieler ({otherGuests.length})
              </summary>
              <PlayerColumn
                describedBy={describedBy}
                heading="Andere Vereine"
                onToggle={(playerId) => onToggle("B", playerId)}
                players={otherGuests}
                selected={sideBIds}
              />
            </details>
          ) : null}
          <GuestPlayersPanel clubName={sideBName} onCreated={onGuestsCreated} organizationId={organizationId} />
        </div>
      </div>
    </section>
  );
}

function PlayerColumn({ action = null, describedBy, heading, onToggle, players, selected }: {
  readonly action?: ReactNode;
  readonly describedBy: string | undefined;
  readonly heading: string;
  readonly players: readonly PlayerResponse[];
  readonly selected: readonly string[];
  readonly onToggle: (playerId: string) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="font-plate text-label font-semibold uppercase tracking-[0.14em] text-sisal-500">
        {heading}
      </legend>
      {action !== null ? <div className="mt-2">{action}</div> : null}
      {players.length === 0 ? (
        <p className="mt-2 font-plate text-caption text-sisal-500">Noch keine Spieler.</p>
      ) : null}
      <ul className="mt-2 flex flex-col">
        {players.map((player) => (
          // Der Verein steht neben dem Label: der zugängliche Name bleibt der Anzeigename.
          <li className="flex items-center gap-2.5 border-b border-sisal-300" key={player.id}>
            <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-1.5 font-plate text-body text-wedge-900">
              <input
                aria-describedby={describedBy}
                checked={selected.includes(player.id)}
                className="size-4 shrink-0 accent-ring-green"
                onChange={() => onToggle(player.id)}
                type="checkbox"
              />
              <span className="truncate" title={player.displayName}>{player.displayName}</span>
            </label>
            {player.kind === "GUEST" && player.guestClubName !== null ? (
              <span className="max-w-[45%] truncate font-plate text-caption text-sisal-500">
                {player.guestClubName}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** Abschnitt 4: Quali-Runden, Grösse der Finalrunde, Spiel um Platz 3. */
export function ClubModeSection({ errors, finalRoundMax, register }: {
  readonly errors: Errors;
  readonly register: UseFormRegister<SetupFormValues>;
  /** Spieler des kleineren Vereins; 0, solange eine Seite leer ist. */
  readonly finalRoundMax: number;
}) {
  return (
    <section aria-labelledby="setup-club-mode">
      <SheetLabel as="h2" id="setup-club-mode">4 · Modus</SheetLabel>
      <Rule className="mt-2" />
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field error={errors.qualifyingRounds ?? null} htmlFor="qualifyingRounds" label="Quali-Runden">
          <SelectInput
            aria-describedby={errors.qualifyingRounds ? "qualifyingRounds-error" : undefined}
            id="qualifyingRounds"
            {...register("qualifyingRounds")}
          >
            {Array.from({ length: 15 }, (_, index) => index + 1).map((count) => (
              <option key={count} value={String(count)}>{count}</option>
            ))}
          </SelectInput>
        </Field>
        <Field
          error={errors.finalRoundSize ?? null}
          {...(finalRoundMax > 0 ? { hint: `Höchstens ${finalRoundMax} (kleinerer Verein).` } : {})}
          htmlFor="finalRoundSize"
          label="Finalrunde (Spieler je Verein)"
        >
          <SelectInput
            aria-describedby={
              errors.finalRoundSize ? "finalRoundSize-error" : finalRoundMax > 0 ? "finalRoundSize-hint" : undefined
            }
            id="finalRoundSize"
            {...register("finalRoundSize")}
          >
            {[2, 3, 4, 5, 6].map((count) => <option key={count} value={String(count)}>{count}</option>)}
          </SelectInput>
        </Field>
        <label
          className="flex min-h-11 cursor-pointer items-center gap-2.5 self-end font-plate text-body text-wedge-900"
          htmlFor="thirdPlaceMatch"
        >
          <input className="size-4 shrink-0 accent-ring-green" id="thirdPlaceMatch" type="checkbox" {...register("thirdPlaceMatch")} />
          Spiel um Platz 3
        </label>
      </div>
    </section>
  );
}

/** Seitenspalte: was die Vereinsduell-Engine aus der Auswahl macht. */
export function ClubDuelPreviewCard({ error, loading, preview, sideAName, sideBName }: {
  readonly preview: ClubDuelPreviewResponse | null;
  readonly loading: boolean;
  readonly sideAName: string;
  readonly sideBName: string;
  readonly error: string | null;
}) {
  const row = (label: string, value: ReactNode) => (
    <div key={label}>
      <dt className="font-plate text-label font-semibold uppercase tracking-[0.14em] text-sisal-500">{label}</dt>
      <dd className="font-numerals text-title font-bold tabular text-wedge-900">{value}</dd>
    </div>
  );
  const perPlayer = (range: { readonly min: number; readonly max: number }) =>
    range.min === range.max ? String(range.min) : `${range.min}–${range.max}`;
  const emptyText = error
    ?? (loading
      ? "Vorschau wird berechnet …"
      : "Wähle auf beiden Seiten mindestens so viele Spieler, wie die Finalrunde Plätze hat.");
  return (
    <Wedge className="p-5" tone="plate">
      <SheetLabel as="h2">Vorschau Vereinsduell</SheetLabel>
      <Rule className="mt-2" tone="faint" />
      {preview === null ? (
        <p className="mt-3 font-plate text-caption text-sisal-500">{emptyText}</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            {row("Quali-Spiele", preview.qualifyingMatches)}
            {row("Finalrunde", preview.finalRoundMatches)}
            {row(`Spiele/Person ${sideAName.trim() || "A"}`, perPlayer(preview.matchesPerPlayer.sideA))}
            {row(`Spiele/Person ${sideBName.trim() || "B"}`, perPlayer(preview.matchesPerPlayer.sideB))}
          </dl>
          <Rule className="mt-4" tone="faint" />
          <p className="mt-3 flex items-baseline justify-between gap-3">
            <span className="font-plate text-body font-semibold text-wedge-900">Spiele insgesamt</span>
            <span className="font-numerals text-data font-bold tabular text-wedge-900">{preview.totalMatches}</span>
          </p>
          <p className="mt-2 font-plate text-caption text-sisal-500">
            ca. {Math.round((preview.estimatedMinutes / 60) * 10) / 10} Std.
          </p>
          {preview.warnings.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-2">
              {preview.warnings.map((warning) => (
                <li className="flex flex-col gap-1" key={warning}>
                  <StateTag label="prüfen" tone="blocked" />
                  <span className="font-plate text-caption text-wedge-900">{warning}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4"><StateTag label="Plan geht auf" tone="free" /></p>
          )}
        </>
      )}
    </Wedge>
  );
}
