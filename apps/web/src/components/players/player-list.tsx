"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { z } from "zod";

import { playerSchema, type PlayerResponse } from "@darts-platform/schemas";
import { Button } from "@darts-platform/ui";

import { apiRequest, ApiClientError, userFacingErrorMessage } from "@/lib/api-client";
import {
  defaultPlayerFilter,
  filterPlayers,
  teamFilterOptions,
  type PlayerFilter,
} from "@/lib/list-filter";
import { ListFilterBar } from "@/components/list-filter-bar";
import { ConfirmDialog } from "@/components/confirm-dialog";

import { PlayerAvatar } from "./player-avatar";
import { PlayerEditDialog } from "./player-edit-dialog";

/**
 * Einmal je Liste statt je Zeile (Task 1): vorher registrierte jede
 * `PlayerRow` eigene `ConfirmDialog`-Instanzen (Archivieren, Löschen) und bei
 * Bedarf einen `PlayerEditDialog`, jede mit eigenem dokumentweiten
 * `focusout`-Listener aus `useDialogFocusReturn`. Diese diskriminierte Union
 * erzwingt zusaetzlich Exklusivitaet: es kann nie mehr als eine Absicht
 * gleichzeitig offen sein (vorher konnten z. B. das Archivieren-Dialog von
 * Spieler A und das Loeschen-Dialog von Spieler B gleichzeitig offen bleiben,
 * weil jede Zeile ihren eigenen Zustand hielt).
 */
type PlayerDialogState =
  | { readonly kind: "edit"; readonly player: PlayerResponse }
  | { readonly kind: "archive"; readonly player: PlayerResponse }
  | { readonly kind: "delete"; readonly player: PlayerResponse };

export function PlayerList({
  players,
  teamsByPlayer,
  organizationId,
  isPending,
  canEdit,
  canArchive,
  canDelete,
  headingRef,
}: {
  readonly players: readonly PlayerResponse[];
  readonly teamsByPlayer: ReadonlyMap<string, readonly string[]>;
  readonly organizationId: string;
  readonly isPending: boolean;
  readonly canEdit: boolean;
  readonly canArchive: boolean;
  readonly canDelete: boolean;
  // Ziel fuer den Fokus nach erfolgreichem endgueltigem Loeschen (Task 1) und
  // nach Archivieren/Reaktivieren, wenn die Zeile dabei aus dem gefilterten
  // Ergebnis faellt (Whole-Branch-Review, Befund 1): der einzige Aufrufer
  // (`roster-route.tsx`) uebergibt immer den Ref auf die Ueberschrift
  // "Spieler", darum kein optionales Prop mehr.
  readonly headingRef: RefObject<HTMLElement | null>;
}) {
  const [filter, setFilter] = useState<PlayerFilter>(defaultPlayerFilter);
  const [dialog, setDialog] = useState<PlayerDialogState | null>(null);
  const [deletedAnnouncement, setDeletedAnnouncement] = useState<string | null>(null);
  // Fokusziel nach erfolgreichem Archivieren/Reaktivieren (Whole-Branch-
  // Review, Befund 1): die Zeile bleibt zwar bestehen, aber der Button, der
  // den Fokus haben sollte, wird durch einen anderen ersetzt (Archivieren <->
  // Reaktivieren) -- `useDialogFocusReturn`/der Browser faenden dafuer kein
  // Ziel mehr vor. Bei gesetztem Statusfilter faellt die Zeile ausserdem ganz
  // aus der gefilterten Sicht; dann greift derselbe Ueberschrift-Fallback wie
  // beim Loeschen.
  const [rowFocusRequest, setRowFocusRequest] = useState<{
    readonly playerId: string;
    readonly label: string;
    readonly expectedStatus: PlayerResponse["status"];
  } | null>(null);
  const queryClient = useQueryClient();

  // Laeuft erst, NACHDEM das Kind `ConfirmDialog` seinen eigenen
  // schliessenden Effekt (Fokus-Rueckgabe an den -- nach dem Loeschen bereits
  // entfernten -- auslösenden Button) durchlaufen hat: React fuehrt Effekte
  // von Kindern vor denen der Elternkomponente aus. Der Griff auf die
  // Ueberschrift gewinnt dadurch deterministisch, statt auf einen Timer zu
  // setzen.
  useEffect(() => {
    if (deletedAnnouncement !== null) headingRef.current?.focus();
  }, [deletedAnnouncement, headingRef]);

  // Dieselbe Reihenfolge-Garantie wie oben (Kind- vor Elterneffekt) gilt auch
  // hier: das Archivieren-Dialog schliesst sich im selben Update, das diesen
  // Effekt ausloest, `ConfirmDialog`s eigene Fokus-Rueckgabe ist also schon
  // gelaufen. Zusaetzlich haengt der Effekt von `players` ab: der Refetch
  // nach `invalidateQueries` kann eine eigene, separat geplante
  // Aktualisierung sein, die den `players`-Stand hinter dem Erfolgs-Callback
  // zurueckliegen laesst -- der Effekt wartet dann einfach auf den naechsten
  // Durchlauf, sobald der neue Status tatsaechlich angekommen ist, statt auf
  // einer festen Verzoegerung zu beruhen. Kein `setState` im Effekt-Koerper
  // (ESLint `react-hooks/set-state-in-effect`): statt die Anfrage nach
  // Erledigung zurueckzusetzen, merkt sich ein Ref, welche Anfrage schon
  // bearbeitet wurde, damit derselbe Fokuswechsel nicht bei jedem spaeteren,
  // unabhaengigen `players`-Update wiederholt wird.
  const handledRowFocusRequestRef = useRef<typeof rowFocusRequest>(null);
  useEffect(() => {
    if (rowFocusRequest === null || handledRowFocusRequestRef.current === rowFocusRequest) return;
    const { playerId, label, expectedStatus } = rowFocusRequest;
    const current = players.find((candidate) => candidate.id === playerId);
    if (current !== undefined && current.status !== expectedStatus) return;
    handledRowFocusRequestRef.current = rowFocusRequest;
    const row = document.querySelector<HTMLElement>(`[data-player-id="${CSS.escape(playerId)}"]`);
    const buttons = row === null ? [] : Array.from(row.querySelectorAll("button"));
    const preferred = buttons.find((button) => button.textContent?.trim() === label);
    // Unter `sm` steht die Knopfreihe per `display: none` im DOM; `focus()`
    // auf einen solchen Knopf bleibt im Browser wirkungslos. Darum der Reihe
    // nach versuchen und beim ersten Kandidaten aufhoeren, der den Fokus
    // tatsaechlich bekommt -- auf dem Telefon ist das der Ausloeser des
    // Aktionsmenues derselben Zeile.
    const trigger = row?.querySelector<HTMLElement>("[data-row-actions-trigger]") ?? null;
    const candidates = [preferred, trigger, buttons[0], headingRef.current];
    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null) continue;
      candidate.focus();
      if (document.activeElement === candidate) return;
    }
  }, [rowFocusRequest, players, headingRef]);

  const invalidatePlayers = () => queryClient.invalidateQueries({ queryKey: ["players", organizationId] });

  // Kein globales `onSuccess` mehr auf der Mutation selbst (Fix-Runde 1,
  // Review-Befund 1): `archiveMutation` ist jetzt fuer die ganze Liste
  // geteilt. Ein globales `onSuccess`/`onError` haette bei jeder Antwort
  // bedingungslos das GERADE offene Dialog angefasst -- auch dann, wenn der
  // Aufruf, der diese Antwort ausgeloest hat, laengst zu einer anderen
  // Person gehoerte (z. B. ein "Stattdessen archivieren" fuer X, dessen
  // Antwort erst eintrifft, nachdem der Loeschen-Dialog fuer Y schon offen
  // ist). Stattdessen bekommt jeder `mutate()`-Aufruf sein eigenes,
  // aufrufgebundenes `onSuccess` (siehe `runArchive`/`onConfirm` unten), das
  // den Zielspieler dieses konkreten Aufrufs geschlossen haelt und nur dann
  // wirkt, wenn das aktuell offene Dialog noch zu genau diesem Spieler
  // gehoert.
  const archiveMutation = useMutation({
    mutationFn: (playerId: string) =>
      apiRequest({
        path: `/organizations/${organizationId}/players/${playerId}`,
        method: "DELETE",
        schema: playerSchema,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (playerId: string) =>
      apiRequest({
        path: `/organizations/${organizationId}/players/${playerId}/permanent`,
        method: "DELETE",
        schema: z.undefined(),
      }),
  });

  const runArchive = (target: PlayerResponse) => {
    archiveMutation.mutate(target.id, {
      onSuccess: async () => {
        await invalidatePlayers();
        // Nur schliessen, wenn das offene Dialog noch dieser Person gehoert
        // -- waehrend der Anfrage kann sich das Dialog dank der Sperre unten
        // zwar nicht mehr aendern, die Pruefung bleibt aber die
        // eigentliche, vom Timing unabhaengige Garantie.
        setDialog((current) => (current !== null && current.player.id === target.id ? null : current));
        setRowFocusRequest({ playerId: target.id, label: "Reaktivieren", expectedStatus: "INACTIVE" });
      },
    });
  };

  const runDelete = (target: PlayerResponse) => {
    deleteMutation.mutate(target.id, {
      onSuccess: async () => {
        await invalidatePlayers();
        setDialog((current) => (current !== null && current.player.id === target.id ? null : current));
        setDeletedAnnouncement(`${target.displayName} wurde gelöscht.`);
      },
    });
  };

  const reactivateMutation = useMutation({
    mutationFn: (playerId: string) =>
      apiRequest({
        path: `/organizations/${organizationId}/players/${playerId}`,
        method: "PATCH",
        body: { status: "ACTIVE" },
        schema: playerSchema,
      }),
  });

  const runReactivate = (target: PlayerResponse) => {
    reactivateMutation.mutate(target.id, {
      onSuccess: async () => {
        await invalidatePlayers();
        setRowFocusRequest({ playerId: target.id, label: "Archivieren", expectedStatus: "ACTIVE" });
      },
    });
  };

  const openEdit = (player: PlayerResponse) => {
    setDeletedAnnouncement(null);
    setDialog({ kind: "edit", player });
  };
  const openArchive = (player: PlayerResponse) => {
    setDeletedAnnouncement(null);
    archiveMutation.reset();
    setDialog({ kind: "archive", player });
  };
  const openDelete = (player: PlayerResponse) => {
    // Beide Mutationen zuruecksetzen, nicht nur deleteMutation: ein
    // vorheriger Archivieren-Fehlversuch (derselbe oder ein anderer Spieler,
    // da die Mutation jetzt Listen- statt Zeilen-Zustand ist) darf im
    // Loeschen-Dialog nicht als stille Karteikarte wieder auftauchen.
    setDeletedAnnouncement(null);
    deleteMutation.reset();
    archiveMutation.reset();
    setDialog({ kind: "delete", player });
  };

  // Beide Mutationen sind fuer die ganze Liste geteilt: `variables` haelt
  // die zuletzt aufgerufene Spieler-ID fest. Ein Abgleich mit dem aktuell
  // offenen Dialog verhindert, dass eine verspaetet eintreffende Antwort
  // (z. B. ein "Stattdessen archivieren" fuer eine laengst geschlossene
  // Person) sich faelschlich einem inzwischen geoeffneten, fremden Dialog
  // zuordnet (Fix-Runde 1, Review-Befund 1).
  const archiveMatchesDialog = dialog !== null && archiveMutation.variables === dialog.player.id;
  const deleteMatchesDialog = dialog !== null && deleteMutation.variables === dialog.player.id;

  const canOfferArchiveInstead =
    dialog !== null &&
    dialog.kind === "delete" &&
    deleteMatchesDialog &&
    deleteMutation.isError &&
    deleteMutation.error instanceof ApiClientError &&
    deleteMutation.error.code === "PLAYER_HAS_HISTORY" &&
    dialog.player.status === "ACTIVE" &&
    canArchive;

  // Das Loeschen-Dialog darf sich nicht schliessen lassen, waehrend eine
  // vom "Stattdessen archivieren"-Knopf ausgeloeste `archiveMutation` fuer
  // GENAU diese Person noch laeuft -- vorher war `pending` hier nur an
  // `deleteMutation.isPending` gebunden, sodass Abbrechen/Escape mitten in
  // dieser Anfrage funktionierten (Fix-Runde 1, Review-Befund 1).
  const deleteDialogPending = deleteMutation.isPending || (archiveMutation.isPending && archiveMatchesDialog);

  const archiveDescription =
    dialog !== null
      ? `${dialog.player.displayName} kann danach keine neuen Matches und Turniere bestreiten. Resultate und Statistik bleiben erhalten, und du kannst den Spieler jederzeit reaktivieren.`
      : "";
  const deleteDescription =
    dialog !== null
      ? `${dialog.player.displayName} wird mit Profilbild und Statistik gelöscht. Das lässt sich nicht rückgängig machen. Spieler, die bereits gespielt haben oder in einem Turnier, Team oder einer Begegnung stehen, lassen sich nur archivieren.${
          dialog.player.hasAccount
            ? " Die Verknüpfung mit dem Benutzerkonto wird dabei aufgehoben; das Konto selbst bleibt bestehen."
            : ""
        }`
      : "";

  const visible = useMemo(
    () => filterPlayers(players, filter, teamsByPlayer),
    [players, filter, teamsByPlayer],
  );
  const teamOptions = useMemo(() => teamFilterOptions(teamsByPlayer), [teamsByPlayer]);
  const isFiltered =
    filter.search.length > 0 ||
    filter.status !== "ALL" ||
    filter.teamId !== "ALL" ||
    filter.account !== "ALL";

  return (
    <div className="space-y-4">
      <ListFilterBar
        isFiltered={isFiltered}
        onReset={() => setFilter(defaultPlayerFilter)}
        onSearchChange={(search) => setFilter((current) => ({ ...current, search }))}
        resultLabel={`${visible.length} von ${players.length} Spielern`}
        search={filter.search}
        searchId="player-search"
        searchLabel="Spieler suchen"
        searchPlaceholder="Name oder Spitzname"
        selects={[
          {
            id: "player-status-filter",
            label: "Status",
            value: filter.status,
            onChange: (value) =>
              setFilter((current) => ({
                ...current,
                status: value as PlayerFilter["status"],
              })),
            options: [
              { value: "ALL", label: "Alle" },
              { value: "ACTIVE", label: "Aktiv" },
              { value: "INACTIVE", label: "Archiviert" },
            ],
          },
          {
            id: "player-team-filter",
            label: "Team",
            value: filter.teamId,
            onChange: (value) => setFilter((current) => ({ ...current, teamId: value })),
            options: [
              { value: "ALL", label: "Alle" },
              { value: "NONE", label: "Ohne Team" },
              ...teamOptions.map((team) => ({ value: team, label: team })),
            ],
          },
          {
            id: "player-account-filter",
            label: "Konto",
            value: filter.account,
            onChange: (value) =>
              setFilter((current) => ({
                ...current,
                account: value as PlayerFilter["account"],
              })),
            options: [
              { value: "ALL", label: "Alle" },
              { value: "WITH", label: "Mit Konto" },
              { value: "WITHOUT", label: "Ohne Konto" },
            ],
          },
        ]}
      />

      {/*
        Immer gemountet (Whole-Branch-Review, Befund 2): eine `role="status"`-
        Region, die erst NACH dem Einhaengen befuellt wird, kuendigt
        Screenreadern nicht zuverlaessig an. Leer statt fehlend, solange
        nichts zu melden ist.
      */}
      <p className="text-body text-slate-300" role="status">
        {deletedAnnouncement ?? ""}
      </p>

      <div className="space-y-3">
        {isPending ? <p className="text-body text-slate-400">Spieler werden geladen …</p> : null}
        {visible.map((player) => (
          <PlayerRow
            canArchive={canArchive}
            canDelete={canDelete}
            canEdit={canEdit}
            key={player.id}
            onArchive={openArchive}
            onDelete={openDelete}
            onEdit={openEdit}
            onReactivate={runReactivate}
            organizationId={organizationId}
            player={player}
            reactivateError={
              reactivateMutation.isError && reactivateMutation.variables === player.id
                ? userFacingErrorMessage(reactivateMutation.error)
                : null
            }
            reactivatePending={reactivateMutation.isPending && reactivateMutation.variables === player.id}
            teams={teamsByPlayer.get(player.id) ?? []}
          />
        ))}
        {!isPending && players.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 p-5 text-body text-slate-400">
            Noch keine Spieler vorhanden.
          </p>
        ) : null}
        {!isPending && players.length > 0 && visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 p-5 text-body text-slate-400">
            Kein Spieler passt zu diesen Filtern.
          </p>
        ) : null}
      </div>

      {dialog?.kind === "edit" ? (
        <PlayerEditDialog onClose={() => setDialog(null)} organizationId={organizationId} player={dialog.player} />
      ) : null}

      <ConfirmDialog
        confirmLabel={dialog?.kind === "archive" ? "Archivieren" : "Endgültig löschen"}
        confirmVariant={dialog?.kind === "archive" ? "primary" : "danger"}
        description={dialog?.kind === "archive" ? archiveDescription : deleteDescription}
        error={
          dialog?.kind === "archive"
            ? archiveMutation.isError && archiveMatchesDialog
              ? userFacingErrorMessage(archiveMutation.error)
              : null
            : dialog?.kind === "delete"
              ? deleteMutation.isError && deleteMatchesDialog
                ? userFacingErrorMessage(deleteMutation.error)
                : null
              : null
        }
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog === null) return;
          if (dialog.kind === "archive") runArchive(dialog.player);
          else if (dialog.kind === "delete") runDelete(dialog.player);
        }}
        open={dialog?.kind === "archive" || dialog?.kind === "delete"}
        pending={dialog?.kind === "archive" ? archiveMutation.isPending : deleteDialogPending}
        title={dialog?.kind === "archive" ? "Spieler archivieren" : "Spieler endgültig löschen"}
      >
        {canOfferArchiveInstead ? (
          <>
            <Button
              disabled={archiveMutation.isPending}
              onClick={() => {
                if (dialog !== null) runArchive(dialog.player);
              }}
              type="button"
              variant="outline"
            >
              Stattdessen archivieren
            </Button>
            {archiveMutation.isError && archiveMatchesDialog ? (
              <p className="text-body text-rose-300" role="alert">
                {userFacingErrorMessage(archiveMutation.error)}
              </p>
            ) : null}
          </>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

/**
 * Nur die Angaben, die tatsaechlich vorliegen: auf dem Telefon frass die
 * alte Zeile "Kein Spitzname · Aktiv · Ohne Team · Kein Konto verknüpft"
 * eine ganze Zeile pro Spieler, ohne etwas mitzuteilen. "Aktiv" ist der
 * Normalfall und faellt weg; "Archiviert" bleibt als Wort stehen, nicht nur
 * als Farbe (AGENTS.md §19).
 */
export function playerMetaFacts(player: PlayerResponse, teams: readonly string[]): readonly string[] {
  const facts: string[] = [];
  if (player.nickname !== null && player.nickname.trim().length > 0) facts.push(player.nickname);
  if (teams.length > 0) facts.push(teams.join(", "));
  if (player.hasAccount) facts.push("Konto verknüpft");
  if (player.status === "INACTIVE") facts.push("Archiviert");
  return facts;
}

function PlayerRow({
  player,
  teams,
  organizationId,
  canEdit,
  canArchive,
  canDelete,
  onEdit,
  onArchive,
  onDelete,
  onReactivate,
  reactivatePending,
  reactivateError,
}: {
  readonly player: PlayerResponse;
  readonly teams: readonly string[];
  readonly organizationId: string;
  readonly canEdit: boolean;
  readonly canArchive: boolean;
  readonly canDelete: boolean;
  readonly onEdit: (player: PlayerResponse) => void;
  readonly onArchive: (player: PlayerResponse) => void;
  readonly onDelete: (player: PlayerResponse) => void;
  readonly onReactivate: (player: PlayerResponse) => void;
  readonly reactivatePending: boolean;
  readonly reactivateError: string | null;
}) {
  const facts = playerMetaFacts(player, teams);
  const showArchive = canArchive && player.status === "ACTIVE";
  const showReactivate = canEdit && player.status === "INACTIVE";
  const hasActions = canEdit || showArchive || showReactivate || canDelete;

  return (
    <div
      className="min-h-16 rounded-xl border border-slate-800 bg-slate-950/50 p-3 sm:p-4"
      data-player-id={player.id}
    >
      <div className="flex items-start justify-between gap-3 sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          {/* Ersetzt den frueheren Knopf "Profil": der Name selbst fuehrt zum
              Profil, das spart auf dem Telefon einen Knopf je Zeile. */}
          <Link
            className="inline-flex min-h-11 max-w-full items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green"
            href={`/spieler/${player.id}?organisation=${organizationId}`}
          >
            <PlayerAvatar decorative organizationId={organizationId} player={player} size={40} />
            <span className="min-w-0 font-semibold break-words text-white hover:text-emerald-300">
              {player.displayName}
            </span>
          </Link>
          {facts.length > 0 ? (
            <p className="pl-13 text-caption break-words text-slate-400">{facts.join(" · ")}</p>
          ) : null}
        </div>
        {hasActions ? (
          <>
            {/* Ab `sm` wie bisher als Knopfreihe; darunter nur das Aktionsmenue.
                Beide Varianten stehen im Markup und werden per CSS umgeschaltet
                (keine JS-Media-Query, damit SSR und Hydrierung gleich bleiben).
                `display: none` nimmt die jeweils andere Variante auch aus dem
                Accessibility-Baum. */}
            <div className="hidden flex-wrap justify-end gap-2 sm:flex">
              {canEdit ? (
                <Button variant="outline" onClick={() => onEdit(player)}>
                  Bearbeiten
                </Button>
              ) : null}
              {showArchive ? (
                <Button variant="outline" onClick={() => onArchive(player)}>
                  Archivieren
                </Button>
              ) : null}
              {showReactivate ? (
                <Button disabled={reactivatePending} onClick={() => onReactivate(player)} variant="outline">
                  Reaktivieren
                </Button>
              ) : null}
              {canDelete ? (
                <Button variant="outline" onClick={() => onDelete(player)}>
                  Löschen
                </Button>
              ) : null}
            </div>
            <div className="shrink-0 sm:hidden">
              <PlayerActionsMenu
                displayName={player.displayName}
                items={[
                  ...(canEdit ? [{ label: "Bearbeiten", run: () => onEdit(player) }] : []),
                  ...(showArchive ? [{ label: "Archivieren", run: () => onArchive(player) }] : []),
                  ...(showReactivate
                    ? [{ label: "Reaktivieren", run: () => onReactivate(player), disabled: reactivatePending }]
                    : []),
                  ...(canDelete ? [{ label: "Löschen", run: () => onDelete(player), destructive: true }] : []),
                ]}
              />
            </div>
          </>
        ) : null}
      </div>
      {reactivateError !== null ? (
        <p className="mt-2 text-body text-rose-300" role="alert">
          {reactivateError}
        </p>
      ) : null}
    </div>
  );
}

interface PlayerAction {
  readonly label: string;
  readonly run: () => void;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
}

/**
 * Aktionsmenue fuer schmale Bildschirme.
 *
 * Bewusst React-Zustand statt nativer Popover-API: das Menue wird nur
 * gerendert, solange es offen ist. Damit stehen "Bearbeiten"/"Löschen" usw.
 * geschlossen nicht ein zweites Mal im DOM -- weder in happy-dom (das keine
 * UA-Regel `[popover]:not(:popover-open) { display: none }` anwendet) noch
 * fuer Playwrights strikte `getByRole`-Abfragen. Escape, Klick ausserhalb und
 * Tab aus dem Menue schliessen es; Escape und die Auswahl eines Eintrags
 * geben den Fokus an den Ausloeser zurueck. Ein Klick ausserhalb laesst den
 * Fokus dort, wo hingeklickt wurde.
 *
 * Die Eintraege sind schlichte Knoepfe (kein `role="menu"`, das eine eigene
 * Pfeiltasten-Navigation verlangen wuerde); Tab reicht fuer drei Eintraege.
 * Der Ausloeser traegt `data-row-actions-trigger`, damit die Fokus-Rueckgabe
 * nach Archivieren/Reaktivieren ihn auf dem Telefon findet.
 */
function PlayerActionsMenu({
  displayName,
  items,
}: {
  readonly displayName: string;
  readonly items: readonly PlayerAction[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const container = containerRef.current;
      if (container !== null && event.target instanceof Node && container.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  const select = (item: PlayerAction) => {
    setOpen(false);
    // Vor der Aktion: ein danach geoeffneter Dialog merkt sich so den
    // Ausloeser (und nicht den gleich verschwindenden Menueeintrag) als Ziel
    // seiner Fokus-Rueckgabe (`useDialogFocusReturn`).
    triggerRef.current?.focus();
    item.run();
  };

  return (
    <div
      className="relative"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (open && next instanceof Node && !event.currentTarget.contains(next)) setOpen(false);
      }}
      ref={containerRef}
    >
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-label={`Aktionen für ${displayName}`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-body font-semibold text-slate-100 transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green"
        data-row-actions-trigger=""
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        Aktionen
        <svg
          aria-hidden="true"
          className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div
          className="absolute top-full right-0 z-20 mt-1 w-48 rounded-xl border border-slate-700 bg-slate-950 p-1 shadow-2xl"
          id={menuId}
          ref={menuRef}
        >
          {items.map((item) => (
            <Fragment key={item.label}>
              {item.destructive === true ? <div aria-hidden="true" className="mx-2 my-1 border-t border-slate-800" /> : null}
              <button
                className={`flex min-h-11 w-full items-center rounded-lg px-3 text-left text-body font-medium transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring-green disabled:opacity-50 ${
                  item.destructive === true ? "text-ring-red" : "text-slate-100"
                }`}
                disabled={item.disabled}
                onClick={() => select(item)}
                type="button"
              >
                {item.label}
              </button>
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
