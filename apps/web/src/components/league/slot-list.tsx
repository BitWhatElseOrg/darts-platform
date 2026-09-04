"use client";

import type {
  BoardResponse,
  EncounterDetail,
  EncounterSide,
  EncounterSlotView,
} from "@darts-platform/schemas";
import { Control, Field, Rule, SelectInput, SheetLabel, StateTag, TextInput } from "@darts-platform/ui";
import Link from "next/link";
import { useState } from "react";

import { encounterTally, slotAvailability } from "@/lib/encounter-view";
import { matchScoreboardHref } from "@/lib/match-navigation";
import { disciplineLabel, slotOutcomeLabel, slotStatusLabel, slotTone, variantLabel } from "@/lib/league-format";

export interface SlotListProps {
  readonly encounter: EncounterDetail;
  readonly boards: readonly BoardResponse[];
  readonly organizationId: string;
  readonly canManage: boolean;
  readonly canScore: boolean;
  readonly busy: boolean;
  readonly onAssign: (slotId: string, boardId: string) => void;
  readonly onRelease: (slotId: string) => void;
  readonly onWalkover: (slotId: string, winnerSide: EncounterSide, reason: string) => void;
}

function names(players: readonly { readonly displayName: string }[]): string {
  return players.map((player) => player.displayName).join(" · ");
}

export function SlotList(props: SlotListProps) {
  const freeBoards = props.boards.filter((board) => board.status === "AVAILABLE");

  return (
    <section aria-labelledby="slots-heading">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <SheetLabel as="h2" id="slots-heading">
          Spiele der Begegnung
        </SheetLabel>
        <span className="shrink-0 font-numerals text-counter font-bold tabular text-sisal-500">
          {encounterTally(props.encounter).total}
        </span>
      </div>
      <Rule />

      <ul className="mt-4 flex flex-col gap-3">
        {[...props.encounter.slots]
          .sort((first, second) => first.sequence - second.sequence)
          .map((slot) => (
            <SlotRow freeBoards={freeBoards} key={slot.id} slot={slot} {...props} />
          ))}
      </ul>
    </section>
  );
}

function SlotRow({
  busy,
  canManage,
  canScore,
  encounter,
  freeBoards,
  onAssign,
  onRelease,
  onWalkover,
  organizationId,
  slot,
}: SlotListProps & {
  readonly slot: EncounterSlotView;
  readonly freeBoards: readonly BoardResponse[];
}) {
  const [boardId, setBoardId] = useState("");
  const [winnerSide, setWinnerSide] = useState<EncounterSide>("HOME");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const availability = slotAvailability(encounter, slot);

  return (
    <li className="border border-sisal-400 bg-sisal-100 p-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 sm:gap-x-6">
        <span className="w-8 shrink-0 font-numerals text-title font-bold tabular text-wedge-900">
          {slot.sequence}
        </span>

        <div className="min-w-0 flex-1 basis-[calc(100%-3rem)] sm:basis-0">
          <p className="font-plate text-field font-semibold text-wedge-900">{slot.label}</p>
          <p className="mt-0.5 font-plate text-caption text-sisal-500">
            {disciplineLabel(slot.discipline)} ·{" "}
            {variantLabel({
              startingScore: slot.startingScore,
              inRule: slot.inRule,
              outRule: slot.outRule,
            })}{" "}
            · Best of {slot.bestOfLegs}
          </p>
        </div>

        <dl className="min-w-0 flex-1 basis-full sm:basis-0 sm:min-w-[16rem]">
          <div className="flex items-baseline gap-3">
            <dt className="w-12 font-plate text-label font-semibold tracking-[0.14em] text-sisal-500 uppercase">
              Heim
            </dt>
            <dd className="min-w-0 flex-1 font-plate text-field text-wedge-900">
              {slot.home.complete ? names(slot.home.players) : "noch offen"}
            </dd>
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <dt className="w-12 font-plate text-label font-semibold tracking-[0.14em] text-sisal-500 uppercase">
              Gast
            </dt>
            <dd className="min-w-0 flex-1 font-plate text-field text-wedge-900">
              {slot.away.complete ? names(slot.away.players) : "noch offen"}
            </dd>
          </div>
        </dl>

        <div className="w-20 shrink-0">
          <SheetLabel>Sätze</SheetLabel>
          <p className="mt-1 font-numerals text-counter font-bold tabular text-wedge-900">
            {slot.homeLegs}:{slot.awayLegs}
          </p>
        </div>

        <div className="w-40 shrink-0">
          <StateTag label={slotStatusLabel(slot.status)} tone={slotTone(slot.status)} />
          <p className="mt-1 font-plate text-caption text-sisal-500">
            {slot.winnerSide === null
              ? slot.boardName === null
                ? ""
                : slot.boardName
              : slotOutcomeLabel({ winnerSide: slot.winnerSide, resultType: slot.resultType })}
          </p>
        </div>
      </div>

      {canManage || (canScore && slot.matchId !== null) ? (
        <div className="mt-4 border-t border-sisal-300 pt-3">
          {slot.status === "IN_PROGRESS" ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              {slot.matchId === null ? null : (
                <Link
                  className="inline-flex min-h-11 items-center rounded-lg border border-wedge-900 px-4 font-plate text-caption font-semibold tracking-[0.12em] text-wedge-900 uppercase hover:bg-sisal-50"
                  href={matchScoreboardHref({
                    matchId: slot.matchId,
                    organizationId,
                    encounterId: encounter.id,
                  })}
                >
                  Scoreboard
                </Link>
              )}
              {canManage ? (
                <>
                  <Control
                    density="tight"
                    disabled={busy}
                    onClick={() => onRelease(slot.id)}
                    variant="wire"
                  >
                    Board freigeben
                  </Control>
                  <p className="font-plate text-caption text-sisal-500">
                    Das laufende Match wird abgebrochen und das Spiel wieder geöffnet.
                  </p>
                </>
              ) : null}
            </div>
          ) : availability.assignable && canManage ? (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (boardId === "") return;
                onAssign(slot.id, boardId);
              }}
            >
              {freeBoards.length === 0 ? (
                <p className="font-plate text-body text-sisal-500">
                  Kein Board frei. Sobald ein Spiel endet, wird sein Board wieder angeboten.
                </p>
              ) : (
                <>
                  <Field
                    className="sm:min-w-[12rem]"
                    htmlFor={`slot-${slot.id}-board`}
                    label="Board"
                  >
                    <SelectInput
                      id={`slot-${slot.id}-board`}
                      onChange={(event) => setBoardId(event.target.value)}
                      value={boardId}
                    >
                      <option value="">Board wählen …</option>
                      {freeBoards.map((board) => (
                        <option key={board.id} value={board.id}>
                          {board.name}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                  <Control disabled={busy || boardId === ""} type="submit" variant="go">
                    Auf Board starten
                  </Control>
                </>
              )}
            </form>
          ) : (
            <p className="font-plate text-body text-sisal-500 prose-de">{availability.reason}</p>
          )}

          {canManage && slot.status === "WAITING" && encounter.status === "RUNNING" ? (
            <details className="mt-3">
              <summary className="cursor-pointer font-plate text-caption font-semibold tracking-[0.12em] text-sisal-500 uppercase">
                Kampflos werten
              </summary>
              <form
                className="mt-3 flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (reason.trim().length < 3) {
                    setReasonError("Eine Begründung ist Pflicht und wird auditiert.");
                    return;
                  }
                  setReasonError(null);
                  onWalkover(slot.id, winnerSide, reason.trim());
                }}
              >
                <Field
                  className="sm:min-w-[10rem]"
                  htmlFor={`slot-${slot.id}-winner`}
                  label="Sieger"
                >
                  <SelectInput
                    id={`slot-${slot.id}-winner`}
                    onChange={(event) =>
                      setWinnerSide(event.target.value === "AWAY" ? "AWAY" : "HOME")
                    }
                    value={winnerSide}
                  >
                    <option value="HOME">Heim</option>
                    <option value="AWAY">Gast</option>
                  </SelectInput>
                </Field>
                <Field
                  className="min-w-0 flex-1 basis-full sm:basis-0 sm:min-w-[16rem]"
                  error={reasonError}
                  hint="Reglement 2.2.6: der Grund gehört auf den Spielrapport."
                  htmlFor={`slot-${slot.id}-reason`}
                  label="Begründung"
                >
                  <TextInput
                    id={`slot-${slot.id}-reason`}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="nicht an der Abwurflinie erschienen"
                    value={reason}
                  />
                </Field>
                <Control disabled={busy} type="submit" variant="danger">
                  Kampflos werten
                </Control>
              </form>
            </details>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
