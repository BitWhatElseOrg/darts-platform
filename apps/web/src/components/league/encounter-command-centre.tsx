"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { boardListSchema, type EncounterSide } from "@darts-platform/schemas";
import { Control, Field, MarkCross, Rule, SelectInput, SheetLabel, TextInput, Wedge } from "@darts-platform/ui";
import Link from "next/link";
import { useCallback, useState } from "react";

import { apiRequest } from "@/lib/api-client";
import { deciderNotice } from "@/lib/encounter-view";
import { sideLabel } from "@/lib/league-format";
import { DoublesPanel } from "./doubles-panel";
import { EncounterScoreline } from "./encounter-scoreline";
import { LineupPanel } from "./lineup-panel";
import { SlotList } from "./slot-list";
import { SubstitutionPanel } from "./substitution-panel";
import { useEncounterCommand } from "./use-encounter-command";

export interface EncounterAbilities {
  readonly manage: boolean;
  readonly lineup: boolean;
  readonly score: boolean;
}

export function EncounterCommandCentre({
  abilities,
  encounterId,
  organizationId,
}: {
  readonly abilities: EncounterAbilities;
  readonly encounterId: string;
  readonly organizationId: string;
}) {
  const queryClient = useQueryClient();
  const commands = useEncounterCommand({ organizationId, encounterId });
  const boardsQuery = useQuery({
    queryKey: ["boards", organizationId],
    queryFn: ({ signal }) =>
      apiRequest({ path: `/organizations/${organizationId}/boards`, schema: boardListSchema, signal }),
  });

  const base = `/organizations/${organizationId}/encounters/${encounterId}`;
  const refreshBoards = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ["boards", organizationId] }),
    [organizationId, queryClient],
  );

  const start = () =>
    void commands.run({ path: `${base}/start`, body: {}, announce: "Die Begegnung läuft." });
  const assign = (slotId: string, boardId: string) =>
    void commands
      .run({
        path: `${base}/slots/${slotId}/assign`,
        body: { boardId },
        announce: "Spiel gestartet.",
      })
      .then(refreshBoards);
  const release = (slotId: string) =>
    void commands
      .run({ path: `${base}/slots/${slotId}/release`, body: {}, announce: "Board freigegeben." })
      .then(refreshBoards);
  const walkover = (slotId: string, winnerSide: EncounterSide, reason: string) =>
    void commands.run({
      path: `${base}/slots/${slotId}/walkover`,
      body: { winnerSide, reason },
      announce: "Spiel kampflos gewertet.",
    });
  const submitNominations = (
    side: EncounterSide,
    nominations: readonly {
      readonly position: number | null;
      readonly playerId: string;
      readonly origin: "SQUAD" | "GUEST";
    }[],
  ) =>
    void commands.run({
      path: `${base}/nominations`,
      body: { side, nominations },
      announce: `Meldung ${sideLabel(side)} erfasst.`,
    });
  const submitDoubles = (
    side: EncounterSide,
    pairings: readonly { readonly sequence: number; readonly playerIds: readonly string[] }[],
  ) =>
    void commands.run({
      path: `${base}/doubles`,
      body: { side, pairings },
      announce: "Doppelpaarung erfasst.",
    });
  const substitute = (body: {
    readonly side: EncounterSide;
    readonly position: number;
    readonly outPlayerId: string;
    readonly inPlayerId: string;
    readonly effectiveFromSequence: number;
    readonly reason: string | null;
  }) => void commands.run({ path: `${base}/substitutions`, body, announce: "Auswechslung erfasst." });
  const forfeit = (forfeitSide: EncounterSide, reason: string) =>
    void commands
      .run({ path: `${base}/forfeit`, body: { forfeitSide, reason }, announce: "Nichtantritt gewertet." })
      .then(refreshBoards);
  const cancel = (reason: string) =>
    void commands
      .run({ path: `${base}/cancel`, body: { reason }, announce: "Begegnung abgesagt." })
      .then(refreshBoards);

  if (commands.isPending) return <RouteNotice message="Begegnung wird geladen …" />;
  const encounter = commands.encounter;
  if (encounter === undefined) {
    return <RouteNotice message={commands.loadError ?? "Begegnung konnte nicht geladen werden."} />;
  }

  const notice = deciderNotice(encounter);
  const missingSide =
    !encounter.home.submitted && !encounter.away.submitted
      ? "beider Mannschaften"
      : !encounter.home.submitted
        ? "der Heimmannschaft"
        : !encounter.away.submitted
          ? "der Gastmannschaft"
          : null;

  return (
    <div className="sektorenring min-h-screen">
      <div className="mx-auto max-w-[1600px] px-5 py-6 xl:px-9">
        <nav className="mb-5 flex flex-wrap gap-5">
          <Link
            className={navLinkClassName}
            href={`/liga/${encounter.competitionId}?organisation=${organizationId}`}
          >
            Wettbewerb
          </Link>
          <Link className={navLinkClassName} href={`/live/begegnungen/${encounter.publicId}`}>
            Öffentliche Live-Ansicht
          </Link>
        </nav>

        <EncounterScoreline encounter={encounter} organizationId={organizationId} />

        {commands.conflict ? (
          <Wedge className="mt-5 flex flex-wrap items-start gap-4 p-4" tone="alarm">
            <MarkCross className="mt-0.5 shrink-0 text-ring-red" size={16} />
            <div className="min-w-0 flex-1">
              <SheetLabel as="h2" tone="alarm">
                Versionskonflikt · HTTP 409
              </SheetLabel>
              <p className="mt-1.5 font-plate text-[0.875rem] leading-snug text-wedge-900">
                Deine Eingabe ging von Version {commands.conflict.expected} aus, der Server steht auf{" "}
                {commands.conflict.server}. Übernimm den aktuellen Serverzustand und prüfe erneut.
              </p>
            </div>
            <Control onClick={commands.acceptServerState} variant="plate">
              Serverzustand übernehmen
            </Control>
          </Wedge>
        ) : null}

        {commands.error !== null && commands.conflict === null ? (
          <Wedge className="mt-5 p-4" tone="alarm">
            <SheetLabel as="h2" tone="alarm">
              Befehl nicht ausgeführt
            </SheetLabel>
            <p className="mt-1.5 font-plate text-[0.875rem] text-wedge-900">{commands.error}</p>
          </Wedge>
        ) : null}

        {notice === null ? null : (
          <Wedge className="mt-5 p-4" tone="plate">
            <SheetLabel as="h2">Entscheidungsdoppel</SheetLabel>
            <p className="mt-1.5 font-plate text-[0.875rem] text-wedge-900">{notice}</p>
          </Wedge>
        )}

        {abilities.manage && encounter.status !== "COMPLETED" && encounter.status !== "CANCELLED" ? (
          <Wedge className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 p-4" tone="plate">
            <Control
              disabled={commands.busy || encounter.status !== "READY"}
              onClick={start}
              variant="go"
            >
              Begegnung starten
            </Control>
            <p className="min-w-0 flex-1 font-plate text-[0.875rem] text-wedge-900">
              {encounter.status === "RUNNING"
                ? "Die Begegnung läuft. Weise Spiele einem Board zu, sobald beide Seiten besetzt sind."
                : missingSide !== null
                  ? `Es fehlt noch die Meldung ${missingSide}.`
                  : "Meldet eine Seite nur drei Positionen, gelten deren Einzel und ein Doppel beim Start sofort als kampflos verloren."}
            </p>
          </Wedge>
        ) : null}

        <div className="mt-6 grid items-start gap-x-8 gap-y-7 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <SlotList
            boards={boardsQuery.data ?? []}
            busy={commands.busy}
            canManage={abilities.manage}
            canScore={abilities.score}
            encounter={encounter}
            onAssign={assign}
            onRelease={release}
            onWalkover={walkover}
            organizationId={organizationId}
          />

          <div className="flex flex-col gap-7">
            {(["HOME", "AWAY"] as const).map((side) => (
              <LineupPanel
                busy={commands.busy}
                canEdit={abilities.lineup}
                encounter={encounter}
                key={side}
                onSubmit={submitNominations}
                organizationId={organizationId}
                side={side}
              />
            ))}
            {(["HOME", "AWAY"] as const).map((side) => (
              <DoublesPanel
                busy={commands.busy}
                canEdit={abilities.lineup}
                encounter={encounter}
                key={side}
                onSubmit={submitDoubles}
                side={side}
              />
            ))}
            {(["HOME", "AWAY"] as const).map((side) => (
              <SubstitutionPanel
                busy={commands.busy}
                canEdit={abilities.lineup}
                encounter={encounter}
                key={side}
                onSubmit={substitute}
                side={side}
              />
            ))}
          </div>
        </div>

        {abilities.manage && encounter.status !== "COMPLETED" && encounter.status !== "CANCELLED" ? (
          <ClosingActions busy={commands.busy} onCancel={cancel} onForfeit={forfeit} />
        ) : null}

        <Rule className="mt-10" />
        <p className="pt-4 font-plate text-[0.75rem] text-sisal-500">
          Serverstand · Echtzeit {commands.realtime}
        </p>
      </div>
      <p aria-live="polite" className="sr-only" role="status">
        {commands.announcement}
      </p>
    </div>
  );
}

function ClosingActions({
  busy,
  onCancel,
  onForfeit,
}: {
  readonly busy: boolean;
  readonly onCancel: (reason: string) => void;
  readonly onForfeit: (side: EncounterSide, reason: string) => void;
}) {
  const [forfeitSide, setForfeitSide] = useState<EncounterSide>("AWAY");
  const [forfeitReason, setForfeitReason] = useState("");
  const [forfeitError, setForfeitError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);

  return (
    <div className="mt-9 grid gap-5 lg:grid-cols-2">
      <details className="border border-sisal-400 bg-sisal-100 p-4">
        <summary className="cursor-pointer font-plate text-[0.75rem] font-semibold tracking-[0.12em] text-sisal-500 uppercase">
          Nichtantritt werten
        </summary>
        <p className="mt-3 font-plate text-[0.875rem] text-wedge-900">
          Ein Nichtantritt wertet die ganze Begegnung: 0:3 Punkte, 0:18 Spiele, 0:36 Sätze für die
          nicht angetretene Mannschaft (Reglement 2.1.1 und 2.5.1). Alle Spiele entfallen.
        </p>
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (forfeitReason.trim().length < 3) {
              setForfeitError("Eine Begründung ist Pflicht und wird auditiert.");
              return;
            }
            setForfeitError(null);
            onForfeit(forfeitSide, forfeitReason.trim());
          }}
        >
          <Field className="min-w-[10rem]" htmlFor="forfeit-side" label="Nicht angetreten">
            <SelectInput
              id="forfeit-side"
              onChange={(event) => setForfeitSide(event.target.value === "HOME" ? "HOME" : "AWAY")}
              value={forfeitSide}
            >
              <option value="HOME">Heim</option>
              <option value="AWAY">Gast</option>
            </SelectInput>
          </Field>
          <Field
            className="min-w-[16rem] flex-1"
            error={forfeitError}
            htmlFor="forfeit-reason"
            label="Begründung"
          >
            <TextInput
              id="forfeit-reason"
              onChange={(event) => setForfeitReason(event.target.value)}
              placeholder="Mannschaft nicht angetreten"
              value={forfeitReason}
            />
          </Field>
          <Control disabled={busy} type="submit" variant="danger">
            Nichtantritt werten
          </Control>
        </form>
      </details>

      <details className="border border-sisal-400 bg-sisal-100 p-4">
        <summary className="cursor-pointer font-plate text-[0.75rem] font-semibold tracking-[0.12em] text-sisal-500 uppercase">
          Begegnung absagen
        </summary>
        <p className="mt-3 font-plate text-[0.875rem] text-wedge-900">
          Eine abgesagte Begegnung wird nicht gewertet und lässt sich nicht mehr starten. Für eine
          Verschiebung ist sie neu anzusetzen.
        </p>
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (cancelReason.trim().length < 3) {
              setCancelError("Eine Begründung ist Pflicht und wird auditiert.");
              return;
            }
            setCancelError(null);
            onCancel(cancelReason.trim());
          }}
        >
          <Field
            className="min-w-[16rem] flex-1"
            error={cancelError}
            htmlFor="cancel-reason"
            label="Begründung"
          >
            <TextInput
              id="cancel-reason"
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Spielverschiebung nach 1.4.2"
              value={cancelReason}
            />
          </Field>
          <Control disabled={busy} type="submit" variant="danger">
            Begegnung absagen
          </Control>
        </form>
      </details>
    </div>
  );
}

const navLinkClassName =
  "font-plate text-[0.75rem] font-semibold tracking-[0.14em] text-sisal-500 uppercase underline decoration-sisal-400 decoration-1 underline-offset-4 hover:text-wedge-900";

function RouteNotice({ message }: { readonly message: string }) {
  return (
    <main className="sektorenring min-h-screen px-5 py-12">
      <div className="mx-auto max-w-2xl border border-sisal-400 bg-sisal-100 p-6 font-plate text-wedge-900">
        {message}
      </div>
    </main>
  );
}
