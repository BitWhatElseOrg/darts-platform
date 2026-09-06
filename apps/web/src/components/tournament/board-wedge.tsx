"use client";

import {
  BoardPlate,
  Control,
  MarkFlight,
  Name,
  Rule,
  Score,
  SheetLabel,
  StateTag,
  Wedge,
} from "@darts-platform/ui";
import type { BoardSlot, QueueEntry } from "@darts-platform/schemas";

import { boardStateLabel, minutesBetween, runtimeLabel } from "@/lib/tournament-format";

interface BoardWedgeProps {
  readonly slot: BoardSlot;
  readonly now: Date;
  /** The match the scheduler would put here next, if the board is open. */
  readonly nextUp: QueueEntry | null;
  /** Keyboard digit that assigns to this board. */
  readonly shortcut: string;
  readonly pending: boolean;
  /**
   * Ein Befehl der Zentrale laeuft gerade: Zuweisen und Freigeben sind
   * gesperrt. Echtes `disabled` statt einer blossen Wache im Handler -- sonst
   * sehen die Knoepfe waehrenddessen bedienbar aus (Re-Review, Befund 3).
   */
  readonly disabled: boolean;
  /** Landed within the last interaction: gets the one authored motion. */
  readonly justLanded: boolean;
  readonly onAssign: () => void;
  readonly onRelease: () => void;
}

export function BoardWedge({
  disabled,
  justLanded,
  nextUp,
  now,
  onAssign,
  onRelease,
  pending,
  shortcut,
  slot,
}: BoardWedgeProps) {
  const tone = slot.state === "FREE" ? "free" : slot.state === "BLOCKED" ? "blocked" : "ink";
  const onGround = slot.state === "FREE" ? "sisal" : "ink";

  return (
    <Wedge
      as="article"
      className={justLanded ? "animate-land animate-chalk" : undefined}
      tone={tone}
    >
      <header className="flex items-start gap-3 px-4 pt-3.5 pb-3">
        <BoardPlate
          state={slot.state === "FREE" ? "free" : slot.state === "BLOCKED" ? "blocked" : "playing"}
          value={slot.ringNumber}
        />
        <div className="min-w-0 flex-1">
          <h3
            className={
              slot.state === "FREE"
                ? "truncate font-plate text-field font-semibold text-wedge-900"
                : "truncate font-plate text-field font-semibold text-chalk"
            }
            title={slot.boardName}
          >
            {slot.boardName}
          </h3>
          <p
            className={
              slot.state === "FREE"
                ? "truncate font-plate text-caption text-sisal-500"
                : "truncate font-plate text-caption text-spider/80"
            }
          >
            {slot.match
              ? `${slot.match.stageLabel} · Leg ${slot.match.legNumber} von ${slot.match.bestOfLegs}`
              : slot.state === "FREE"
                ? "offen für die Zuweisung"
                : "nicht im Betrieb"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StateTag
            label={pending ? "wird übertragen" : boardStateLabel(slot.state)}
            on={onGround}
            tone={
              pending
                ? "waiting"
                : slot.state === "FREE"
                  ? "free"
                  : slot.state === "BLOCKED"
                    ? "blocked"
                    : "live"
            }
          />
          {slot.match ? (
            <span
              className={
                slot.match.overrunning
                  ? "font-numerals text-counter font-bold tabular text-ring-red-lit"
                  : "font-numerals text-counter font-bold tabular text-spider/75"
              }
            >
              {runtimeLabel(minutesBetween(slot.match.startedAt, now))}
            </span>
          ) : null}
        </div>
      </header>

      <Rule tone={slot.state === "FREE" ? "faint" : "steel"} />

      {slot.match ? (
        <div className="divide-y divide-spider/15">
          {slot.match.participants.map((participant) => (
            <div
              className="flex items-center gap-3 px-4 py-2.5"
              key={participant.playerId}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5">
                  {participant.isActive ? (
                    <MarkFlight className="shrink-0 text-chalk" size={12} />
                  ) : null}
                  <Name className="truncate" title={participant.displayName} tone={participant.isActive ? "chalk" : "dim"}>
                    {participant.displayName}
                  </Name>
                </p>
                {participant.onFinish && participant.checkoutRoute ? (
                  <p className="mt-1 flex items-center gap-1.5">
                    <StateTag label="Finish" on="ink" tone="finish" />
                    <span className="font-numerals text-counter font-bold tabular text-ring-green-lit">
                      {participant.checkoutRoute}
                    </span>
                  </p>
                ) : null}
              </div>
              <span className="font-numerals text-counter font-bold tabular text-spider/60">
                {participant.legsWon}
              </span>
              <Score
                size={participant.isActive ? "display" : "lead"}
                tone={participant.isActive ? "chalk" : "dim"}
              >
                {participant.remaining}
              </Score>
            </div>
          ))}
        </div>
      ) : slot.state === "BLOCKED" ? (
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="font-plate text-body text-sisal-300">
            {slot.blockedReason ?? "Grund nicht erfasst."}
          </p>
          <Control className="self-start" density="tight" disabled={disabled} onClick={onRelease} variant="wireInk">
            Board freigeben
          </Control>
        </div>
      ) : nextUp ? (
        <div className="flex flex-col gap-3 px-4 py-4">
          <div>
            <SheetLabel>Nächstes Match</SheetLabel>
            <p className="mt-1 font-plate text-field font-semibold text-wedge-900">
              {nextUp.participants[0].displayName}
              <span className="px-1.5 text-sisal-500">–</span>
              {nextUp.participants[1].displayName}
            </p>
            <p className="font-plate text-caption text-sisal-500">{nextUp.stageLabel}</p>
          </div>
          <Control
            className="self-start"
            disabled={disabled}
            icon={<MarkFlight size={13} />}
            onClick={onAssign}
            shortcut={shortcut}
            variant="go"
          >
            Auf {slot.boardName} starten
          </Control>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 py-4">
          <p className="font-plate text-body text-sisal-500">
            Kein Match ist startbereit.
          </p>
          <p className="font-plate text-caption text-sisal-500">
            Die Warteschlange wartet auf Ergebnisse oder eine offene Phase.
          </p>
        </div>
      )}
    </Wedge>
  );
}
