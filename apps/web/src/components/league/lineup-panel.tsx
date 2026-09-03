"use client";

import { useQuery } from "@tanstack/react-query";
import {
  playerListSchema,
  teamListSchema,
  type EncounterDetail,
  type EncounterSide,
} from "@darts-platform/schemas";
import { Control, Field, Rule, SelectInput, SheetLabel, StateTag, Wedge } from "@darts-platform/ui";
import { useState } from "react";

import { apiRequest } from "@/lib/api-client";
import { originLabel, sideLabel } from "@/lib/league-format";

export interface NominationInput {
  readonly position: number | null;
  readonly playerId: string;
  readonly origin: "SQUAD" | "GUEST";
}

const SPARE_SLOTS = 3;

/**
 * Der Spielrapport einer Seite. Die gegnerische Meldung bleibt verdeckt, bis
 * beide gemeldet haben — das entscheidet der Server (Reglement 2.1.1), die
 * Fläche erklärt die Lücke nur.
 */
export function LineupPanel({
  busy,
  canEdit,
  encounter,
  onSubmit,
  organizationId,
  side,
}: {
  readonly busy: boolean;
  readonly canEdit: boolean;
  readonly encounter: EncounterDetail;
  readonly onSubmit: (side: EncounterSide, nominations: readonly NominationInput[]) => void;
  readonly organizationId: string;
  readonly side: EncounterSide;
}) {
  const lineup = side === "HOME" ? encounter.home : encounter.away;
  const editable =
    canEdit && ["DRAFT", "LINEUPS_OPEN", "READY"].includes(encounter.status);

  const teamsQuery = useQuery({
    queryKey: ["teams", organizationId],
    queryFn: ({ signal }) =>
      apiRequest({ path: `/organizations/${organizationId}/teams`, schema: teamListSchema, signal }),
    enabled: editable,
  });
  const playersQuery = useQuery({
    queryKey: ["players", organizationId],
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/organizations/${organizationId}/players`,
        schema: playerListSchema,
        signal,
      }),
    enabled: editable,
  });

  const squad = (teamsQuery.data ?? [])
    .find((team) => team.id === lineup.teamId)
    ?.members.filter((member) => member.validTo === null)
    .map((member) => ({ playerId: member.playerId, displayName: member.displayName }))
    .sort((first, second) => first.displayName.localeCompare(second.displayName, "de-CH")) ?? [];
  const squadIds = new Set(squad.map((member) => member.playerId));
  const guests = (playersQuery.data ?? [])
    .filter((player) => !squadIds.has(player.id))
    .map((player) => ({ playerId: player.id, displayName: player.displayName }));

  return (
    <Wedge aria-labelledby={`lineup-${side}-heading`} as="section" className="p-4" tone="plate">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SheetLabel as="h2" id={`lineup-${side}-heading`}>
          Meldung {sideLabel(side)} · {lineup.teamName}
        </SheetLabel>
        <StateTag
          label={lineup.submitted ? "gemeldet" : "offen"}
          tone={lineup.submitted ? "free" : "waiting"}
        />
      </div>
      <Rule className="mt-2" />

      {lineup.submitted && !lineup.revealed ? (
        <p className="mt-3 font-plate text-[0.875rem] text-wedge-900">
          Gemeldet. Die Aufstellung wird sichtbar, sobald beide Seiten gemeldet haben
          (Reglement 2.1.1).
        </p>
      ) : lineup.nominations.length === 0 ? (
        <p className="mt-3 font-plate text-[0.875rem] text-sisal-500">
          Noch keine Meldung erfasst.
        </p>
      ) : (
        <Roster encounter={encounter} lineupPositions={encounter.lineupPositions} side={side} />
      )}

      {editable ? (
        <NominationForm
          busy={busy}
          encounter={encounter}
          guests={guests}
          onSubmit={onSubmit}
          side={side}
          squad={squad}
        />
      ) : null}
    </Wedge>
  );
}

function Roster({
  encounter,
  lineupPositions,
  side,
}: {
  readonly encounter: EncounterDetail;
  readonly lineupPositions: number;
  readonly side: EncounterSide;
}) {
  const lineup = side === "HOME" ? encounter.home : encounter.away;
  const byPosition = new Map(
    lineup.nominations
      .filter((entry) => entry.position !== null)
      .map((entry) => [entry.position as number, entry] as const),
  );
  const spares = lineup.nominations.filter((entry) => entry.position === null);

  return (
    <div className="mt-3">
      <ol className="flex flex-col">
        {Array.from({ length: lineupPositions }, (_, index) => index + 1).map((position) => {
          const entry = byPosition.get(position);
          return (
            <li
              className="flex items-baseline gap-3 border-b border-sisal-300 py-1.5"
              key={position}
            >
              <span className="w-6 font-numerals text-[1rem] font-bold tabular text-sisal-500">
                {position}
              </span>
              <span className="min-w-0 flex-1 font-plate text-[0.9375rem] text-wedge-900">
                {entry?.displayName ?? "nicht besetzt"}
              </span>
              {entry?.origin === "GUEST" ? (
                <span className="font-plate text-[0.625rem] tracking-[0.14em] text-sisal-500 uppercase">
                  {originLabel("GUEST")}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {spares.length === 0 ? null : (
        <p className="mt-2 font-plate text-[0.875rem] text-sisal-500">
          Ersatz:{" "}
          {spares
            .map((entry) =>
              entry.origin === "GUEST"
                ? `${entry.displayName} (${originLabel("GUEST")})`
                : entry.displayName,
            )
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

function NominationForm({
  busy,
  encounter,
  guests,
  onSubmit,
  side,
  squad,
}: {
  readonly busy: boolean;
  readonly encounter: EncounterDetail;
  readonly guests: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly onSubmit: (side: EncounterSide, nominations: readonly NominationInput[]) => void;
  readonly side: EncounterSide;
  readonly squad: readonly { readonly playerId: string; readonly displayName: string }[];
}) {
  const lineup = side === "HOME" ? encounter.home : encounter.away;
  const positions = Array.from({ length: encounter.lineupPositions }, (_, index) => index + 1);
  const initial = new Map(
    lineup.nominations
      .filter((entry) => entry.position !== null)
      .map((entry) => [entry.position as number, entry.playerId] as const),
  );
  const initialSpares = lineup.nominations
    .filter((entry) => entry.position === null)
    .map((entry) => entry.playerId);

  const [selection, setSelection] = useState<Readonly<Record<number, string>>>(() =>
    Object.fromEntries(positions.map((position) => [position, initial.get(position) ?? ""])),
  );
  const [spares, setSpares] = useState<readonly string[]>(() => [
    ...initialSpares,
    ...Array.from({ length: Math.max(0, SPARE_SLOTS - initialSpares.length) }, () => ""),
  ]);
  const [formError, setFormError] = useState<string | null>(null);

  const guestIds = new Set(guests.map((entry) => entry.playerId));
  const chosen = [...positions.map((position) => selection[position] ?? ""), ...spares].filter(
    (value) => value !== "",
  );
  const duplicate = chosen.length !== new Set(chosen).size;
  const covered = positions.filter((position) => (selection[position] ?? "") !== "").length;
  const shorthanded =
    covered >= encounter.minNominationsShorthanded && covered < encounter.lineupPositions;

  function submit() {
    if (duplicate) {
      setFormError("Eine Person darf nur einmal gemeldet werden.");
      return;
    }
    if (covered < encounter.minNominationsShorthanded) {
      setFormError(
        `Mit weniger als ${encounter.minNominationsShorthanded} Personen wird die Begegnung nicht gestartet, sondern als Nichtantritt gewertet.`,
      );
      return;
    }
    setFormError(null);
    const nominations: NominationInput[] = [];
    for (const position of positions) {
      const playerId = selection[position] ?? "";
      if (playerId === "") continue;
      nominations.push({
        position,
        playerId,
        origin: guestIds.has(playerId) ? "GUEST" : "SQUAD",
      });
    }
    for (const playerId of spares) {
      if (playerId === "") continue;
      nominations.push({
        position: null,
        playerId,
        origin: guestIds.has(playerId) ? "GUEST" : "SQUAD",
      });
    }
    onSubmit(side, nominations);
  }

  return (
    <form
      className="mt-4 border-t border-sisal-300 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-3">
        {positions.map((position) => (
          <Field
            htmlFor={`nomination-${side}-${position}`}
            key={position}
            label={`Position ${position}`}
          >
            <PlayerSelect
              guests={guests}
              id={`nomination-${side}-${position}`}
              onChange={(playerId) =>
                setSelection((current) => ({ ...current, [position]: playerId }))
              }
              squad={squad}
              value={selection[position] ?? ""}
            />
          </Field>
        ))}
        {spares.map((playerId, index) => (
          <Field
            htmlFor={`nomination-${side}-spare-${index}`}
            key={`spare-${index}`}
            label={`Ersatz ${index + 1}`}
          >
            <PlayerSelect
              guests={guests}
              id={`nomination-${side}-spare-${index}`}
              onChange={(next) =>
                setSpares((current) =>
                  current.map((entry, position) => (position === index ? next : entry)),
                )
              }
              squad={squad}
              value={playerId}
            />
          </Field>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Control
          density="tight"
          onClick={() => setSpares((current) => [...current, ""])}
          type="button"
          variant="wire"
        >
          Weitere Person
        </Control>
        <Control disabled={busy} type="submit" variant="plate">
          Meldung {lineup.submitted ? "ersetzen" : "erfassen"}
        </Control>
      </div>

      {formError === null ? null : (
        <p className="mt-2 font-plate text-[0.875rem] text-ring-red-deep" role="alert">
          {formError}
        </p>
      )}
      {formError === null && shorthanded ? (
        <p className="mt-2 font-plate text-[0.875rem] text-sisal-500">
          Mit {covered} Personen gelten die Einzel der fehlenden Position und ein Doppel als
          kampflos verloren (Reglement 2.2.5).
        </p>
      ) : null}
      {formError === null && duplicate ? (
        <p className="mt-2 font-plate text-[0.875rem] text-ring-red-deep" role="alert">
          Eine Person ist mehrfach gewählt.
        </p>
      ) : null}
    </form>
  );
}

function PlayerSelect({
  guests,
  id,
  onChange,
  squad,
  value,
}: {
  readonly guests: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly id: string;
  readonly onChange: (playerId: string) => void;
  readonly squad: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly value: string;
}) {
  return (
    <SelectInput id={id} onChange={(event) => onChange(event.target.value)} value={value}>
      <option value="">nicht besetzt</option>
      <optgroup label="Kader">
        {squad.map((entry) => (
          <option key={entry.playerId} value={entry.playerId}>
            {entry.displayName}
          </option>
        ))}
      </optgroup>
      <optgroup label="Aushilfe (Reglement 1.2.3)">
        {guests.map((entry) => (
          <option key={entry.playerId} value={entry.playerId}>
            {entry.displayName}
          </option>
        ))}
      </optgroup>
    </SelectInput>
  );
}
