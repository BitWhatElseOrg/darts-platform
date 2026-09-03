"use client";

import type { EncounterDetail, EncounterSide } from "@darts-platform/schemas";
import { Control, Field, Rule, SelectInput, SheetLabel, Wedge } from "@darts-platform/ui";
import { useState } from "react";

import { openDoublesSlots } from "@/lib/encounter-view";
import { sideLabel } from "@/lib/league-format";

export interface DoublesPairingInput {
  readonly sequence: number;
  readonly playerIds: readonly string[];
}

/**
 * Doppelpaarungen werden erst unmittelbar vor der Begegnung gemeldet
 * (Reglement 2.1.1 und 2.2.1). Wählbar ist jede gemeldete Person der Seite,
 * auch eine Ersatzperson ohne Einzel.
 */
export function DoublesPanel({
  busy,
  canEdit,
  encounter,
  onSubmit,
  side,
}: {
  readonly busy: boolean;
  readonly canEdit: boolean;
  readonly encounter: EncounterDetail;
  readonly onSubmit: (side: EncounterSide, pairings: readonly DoublesPairingInput[]) => void;
  readonly side: EncounterSide;
}) {
  const lineup = side === "HOME" ? encounter.home : encounter.away;
  const open = openDoublesSlots(encounter, side);
  const [selection, setSelection] = useState<Readonly<Record<string, readonly [string, string]>>>(
    {},
  );
  const [formError, setFormError] = useState<string | null>(null);

  const doublesSlots = encounter.slots.filter((slot) => slot.discipline === "DOUBLES");
  const assignedElsewhere = new Map<string, number>();
  for (const slot of doublesSlots) {
    if (slot.role === "DECIDER") continue;
    const occupancy = side === "HOME" ? slot.home : slot.away;
    if (!occupancy.complete) continue;
    for (const player of occupancy.players) assignedElsewhere.set(player.playerId, slot.sequence);
  }

  if (!lineup.revealed && lineup.submitted) {
    return (
      <Wedge aria-labelledby={`doubles-${side}-heading`} as="section" className="p-4" tone="plate">
        <SheetLabel as="h2" id={`doubles-${side}-heading`}>
          Doppel {sideLabel(side)}
        </SheetLabel>
        <Rule className="mt-2" />
        <p className="mt-3 font-plate text-[0.875rem] text-wedge-900">
          Die Paarungen werden sichtbar, sobald beide Seiten gemeldet haben.
        </p>
      </Wedge>
    );
  }

  return (
    <Wedge aria-labelledby={`doubles-${side}-heading`} as="section" className="p-4" tone="plate">
      <SheetLabel as="h2" id={`doubles-${side}-heading`}>
        Doppel {sideLabel(side)} · {lineup.teamName}
      </SheetLabel>
      <Rule className="mt-2" />

      {doublesSlots.length === 0 ? (
        <p className="mt-3 font-plate text-[0.875rem] text-sisal-500">
          Dieser Wettbewerb kennt keine Doppel.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1">
          {doublesSlots.map((slot) => {
            const occupancy = side === "HOME" ? slot.home : slot.away;
            return (
              <li className="font-plate text-[0.875rem] text-wedge-900" key={slot.id}>
                {slot.label}:{" "}
                {occupancy.complete
                  ? occupancy.players.map((player) => player.displayName).join(" und ")
                  : slot.role === "DECIDER" && !encounter.decider.required
                    ? "wird erst bei Gleichstand gemeldet"
                    : "noch offen"}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && open.length > 0 ? (
        <form
          className="mt-4 border-t border-sisal-300 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            const pairings: DoublesPairingInput[] = [];
            for (const slot of open) {
              const pair = selection[slot.id];
              if (pair === undefined || pair[0] === "" || pair[1] === "") continue;
              if (pair[0] === pair[1]) {
                setFormError("Ein Doppel braucht zwei verschiedene Personen.");
                return;
              }
              pairings.push({ sequence: slot.sequence, playerIds: [pair[0], pair[1]] });
            }
            if (pairings.length === 0) {
              setFormError("Wähle für mindestens ein Doppel beide Personen.");
              return;
            }
            setFormError(null);
            onSubmit(side, pairings);
          }}
        >
          {open.map((slot) => {
            const pair = selection[slot.id] ?? (["", ""] as const);
            const isDecider = slot.role === "DECIDER";
            const candidates = lineup.nominations.filter((entry) => {
              const elsewhere = assignedElsewhere.get(entry.playerId);
              // Im Entscheidungsdoppel gilt die Grenze nicht (Reglement 2.2.1).
              return isDecider || elsewhere === undefined;
            });
            return (
              <fieldset className="mb-4" key={slot.id}>
                <legend className="font-plate text-[0.875rem] font-semibold text-wedge-900">
                  {slot.label}
                </legend>
                <p className="mt-1 font-plate text-[0.75rem] text-sisal-500">
                  {isDecider
                    ? "Im Entscheidungsdoppel darf jede gemeldete Person erneut antreten (Reglement 2.2.1)."
                    : `Jede Person spielt höchstens ${encounter.maxDoublesPerPlayer} reguläres Doppel.`}
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {[0, 1].map((index) => (
                    <Field
                      htmlFor={`doubles-${side}-${slot.id}-${index}`}
                      key={index}
                      label={`Person ${index + 1}`}
                    >
                      <SelectInput
                        id={`doubles-${side}-${slot.id}-${index}`}
                        onChange={(event) =>
                          setSelection((current) => {
                            const next: [string, string] = [...(current[slot.id] ?? ["", ""])] as [
                              string,
                              string,
                            ];
                            next[index] = event.target.value;
                            return { ...current, [slot.id]: next };
                          })
                        }
                        value={pair[index] ?? ""}
                      >
                        <option value="">Person wählen …</option>
                        {candidates.map((entry) => {
                          const elsewhere = assignedElsewhere.get(entry.playerId);
                          return (
                            <option key={entry.playerId} value={entry.playerId}>
                              {entry.displayName}
                              {elsewhere === undefined ? "" : ` · spielt Spiel ${elsewhere}`}
                            </option>
                          );
                        })}
                      </SelectInput>
                    </Field>
                  ))}
                </div>
              </fieldset>
            );
          })}

          <Control disabled={busy} type="submit" variant="plate">
            Paarung melden
          </Control>

          {formError === null ? null : (
            <p className="mt-2 font-plate text-[0.875rem] text-ring-red-deep" role="alert">
              {formError}
            </p>
          )}
        </form>
      ) : canEdit && doublesSlots.length > 0 ? (
        <p className="mt-3 font-plate text-[0.875rem] text-sisal-500">
          Für diese Seite ist nichts offen.
        </p>
      ) : null}
    </Wedge>
  );
}
