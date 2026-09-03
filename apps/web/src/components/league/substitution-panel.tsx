"use client";

import type { EncounterDetail, EncounterSide } from "@darts-platform/schemas";
import { Control, Field, Rule, SelectInput, SheetLabel, TextInput, Wedge } from "@darts-platform/ui";
import { useState } from "react";

import { substitutionContext } from "@/lib/encounter-view";
import { sideLabel } from "@/lib/league-format";

export interface SubstitutionInput {
  readonly side: EncounterSide;
  readonly position: number;
  readonly outPlayerId: string;
  readonly inPlayerId: string;
  readonly effectiveFromSequence: number;
  readonly reason: string | null;
}

/**
 * Auswechslungen sind Teil des Ablaufs, kein Randfall (Reglement 2.2.4 und
 * 2.2.10). `outPlayerId` kommt aus der gewählten Position, nicht aus einem
 * eigenen Feld: wer dort steht, weiss der Server.
 */
export function SubstitutionPanel({
  busy,
  canEdit,
  encounter,
  onSubmit,
  side,
}: {
  readonly busy: boolean;
  readonly canEdit: boolean;
  readonly encounter: EncounterDetail;
  readonly onSubmit: (input: SubstitutionInput) => void;
  readonly side: EncounterSide;
}) {
  const lineup = side === "HOME" ? encounter.home : encounter.away;
  const context = substitutionContext(encounter, side);
  const [position, setPosition] = useState("");
  const [inPlayerId, setInPlayerId] = useState("");
  const [sequence, setSequence] = useState(String(context.minimumSequence));
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const editable = canEdit && encounter.status === "RUNNING" && context.remaining > 0;

  return (
    <Wedge aria-labelledby={`substitution-${side}-heading`} as="section" className="p-4" tone="plate">
      <SheetLabel as="h2" id={`substitution-${side}-heading`}>
        Auswechslung {sideLabel(side)} · {lineup.teamName}
      </SheetLabel>
      <Rule className="mt-2" />

      <p className="mt-3 font-plate text-[0.875rem] text-wedge-900">
        {context.used} von {encounter.maxSubstitutionsPerEncounter} Auswechslungen verbraucht.
      </p>

      {lineup.substitutions.length > 0 ? (
        <ol className="mt-2 flex flex-col gap-1">
          {[...lineup.substitutions]
            .sort((first, second) => first.effectiveFromSequence - second.effectiveFromSequence)
            .map((substitution) => (
              <li className="font-plate text-[0.875rem] text-sisal-500" key={substitution.id}>
                {substitution.outDisplayName} → {substitution.inDisplayName}, Position{" "}
                {substitution.position}, ab Spiel {substitution.effectiveFromSequence}
                {substitution.reason === null ? "" : ` · ${substitution.reason}`}
              </li>
            ))}
        </ol>
      ) : null}

      {!canEdit ? null : encounter.status !== "RUNNING" ? (
        <p className="mt-3 font-plate text-[0.875rem] text-sisal-500">
          Ausgewechselt wird erst, wenn die Begegnung läuft.
        </p>
      ) : context.remaining === 0 ? (
        <p className="mt-3 font-plate text-[0.875rem] text-sisal-500">
          Das Kontingent dieser Begegnung ist erschöpft.
        </p>
      ) : context.available.length === 0 ? (
        <p className="mt-3 font-plate text-[0.875rem] text-sisal-500">
          Für diese Seite ist keine weitere Person gemeldet. Nur gemeldete Personen dürfen
          eingewechselt werden.
        </p>
      ) : null}

      {editable && context.available.length > 0 ? (
        <form
          className="mt-4 border-t border-sisal-300 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            const chosen = context.positions.find(
              (entry) => String(entry.position) === position,
            );
            if (chosen === undefined || inPlayerId === "") {
              setFormError("Wähle die Position und die einwechselnde Person.");
              return;
            }
            const from = Number(sequence);
            if (!Number.isInteger(from) || from < context.minimumSequence) {
              setFormError(
                `Frühestens ab Spiel ${context.minimumSequence}; in eine laufende oder gespielte Paarung wird nicht gewechselt.`,
              );
              return;
            }
            setFormError(null);
            onSubmit({
              side,
              position: chosen.position,
              outPlayerId: chosen.playerId,
              inPlayerId,
              effectiveFromSequence: from,
              reason: reason.trim() === "" ? null : reason.trim(),
            });
          }}
        >
          <div className="flex flex-col gap-3">
            <Field htmlFor={`substitution-${side}-position`} label="Position">
              <SelectInput
                id={`substitution-${side}-position`}
                onChange={(event) => setPosition(event.target.value)}
                value={position}
              >
                <option value="">Position wählen …</option>
                {context.positions.map((entry) => (
                  <option key={entry.position} value={String(entry.position)}>
                    Position {entry.position} · {entry.displayName}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field htmlFor={`substitution-${side}-in`} label="Kommt herein">
              <SelectInput
                id={`substitution-${side}-in`}
                onChange={(event) => setInPlayerId(event.target.value)}
                value={inPlayerId}
              >
                <option value="">Person wählen …</option>
                {context.available.map((entry) => (
                  <option key={entry.playerId} value={entry.playerId}>
                    {entry.displayName}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field
              hint={`Frühestens ab Spiel ${context.minimumSequence}.`}
              htmlFor={`substitution-${side}-sequence`}
              label="Ab Spiel"
            >
              <TextInput
                id={`substitution-${side}-sequence`}
                inputMode="numeric"
                min={context.minimumSequence}
                onChange={(event) => setSequence(event.target.value)}
                type="number"
                value={sequence}
              />
            </Field>
            <Field htmlFor={`substitution-${side}-reason`} label="Begründung (optional)">
              <TextInput
                id={`substitution-${side}-reason`}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Verletzung"
                value={reason}
              />
            </Field>
          </div>

          <Control className="mt-3" disabled={busy} type="submit" variant="plate">
            Auswechseln
          </Control>

          {formError === null ? null : (
            <p className="mt-2 font-plate text-[0.875rem] text-ring-red-deep" role="alert">
              {formError}
            </p>
          )}

          <p className="mt-2 font-plate text-[0.75rem] text-sisal-500">
            Eine ausgewechselte Person bestreitet an diesem Abend kein weiteres Einzel, bleibt für
            die Doppel aber spielberechtigt (Reglement 2.2.4).
          </p>
        </form>
      ) : null}
    </Wedge>
  );
}
