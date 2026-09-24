"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { createPlayerSchema, playerSchema, type PlayerResponse } from "@darts-platform/schemas";
import { Button } from "@darts-platform/ui";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";

import { useDialogFocusReturn } from "../match/use-dialog-focus-return";
import { inputClassName, labelClassName } from "./form-styles";

/**
 * Wie `createPlayerSchema`, aber mit `email` zusaetzlich selbst definiert:
 * die anderen optionalen Felder (`firstName`, `lastName`, `nickname`,
 * `externalReference`) bilden einen geleerten String schon selbst ueber
 * `optionalTrimmedString` auf `null` ab, `email` bleibt dort bewusst bei
 * `z.email()` stehen (fuer die Erstellung gibt es noch kein Formularfeld
 * dafuer). Hier, wo alle sechs Felder editierbar sind, soll ein geleertes
 * E-Mail-Feld genauso "nicht angegeben" heissen wie die anderen
 * (Task-3-Brief: "Leere optionale Felder als null senden").
 *
 * `z.input<>`/`z.output<>` statt `z.infer<>`, weil `email`s Ein- und
 * Ausgabetyp auseinanderlaufen (Eingabe immer `string`, Ausgabe `string |
 * null`): `zodResolver` erwartet fuer `useForm`s `TFieldValues` exakt den
 * Eingabetyp des Schemas, `handleSubmit` liefert dagegen den transformierten
 * Ausgabetyp (RHFs drittes Typparameter `TTransformedValues`).
 */
const playerEditFormSchema = createPlayerSchema
  .pick({
    firstName: true,
    lastName: true,
    displayName: true,
    nickname: true,
    externalReference: true,
  })
  .extend({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .refine((value) => value.length === 0 || z.email().safeParse(value).success, {
        message: "invalid_email",
      })
      .transform((value) => (value.length === 0 ? null : value)),
  });

type PlayerEditFormValues = z.input<typeof playerEditFormSchema>;
type PlayerEditFormOutput = z.output<typeof playerEditFormSchema>;

function defaultsFrom(player: PlayerResponse): PlayerEditFormValues {
  return {
    firstName: player.firstName ?? "",
    lastName: player.lastName ?? "",
    displayName: player.displayName,
    nickname: player.nickname ?? "",
    email: player.email ?? "",
    externalReference: player.externalReference ?? "",
  };
}

export function PlayerEditDialog({
  open,
  player,
  organizationId,
  onClose,
}: {
  readonly open: boolean;
  readonly player: PlayerResponse;
  readonly organizationId: string;
  readonly onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogFocusReturn(dialogRef, open);
  const queryClient = useQueryClient();
  const form = useForm<PlayerEditFormValues, unknown, PlayerEditFormOutput>({
    resolver: zodResolver(playerEditFormSchema),
    defaultValues: defaultsFrom(player),
  });

  const updatePlayer = useMutation({
    mutationFn: (data: PlayerEditFormOutput) =>
      apiRequest({
        path: `/organizations/${organizationId}/players/${player.id}`,
        method: "PATCH",
        body: data,
        schema: playerSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["players", organizationId] });
      onClose();
    },
  });

  // Bei jedem Oeffnen mit dem aktuellen Serverstand vorbelegen -- nicht nur
  // beim ersten Mount: der Dialog bleibt dauerhaft im DOM (siehe
  // `confirm-dialog.tsx`), und zwischen zwei Oeffnungen kann sich `player`
  // durch eine andere Mutation geaendert haben. Ein fehlgeschlagener
  // Speicherversuch aus einer vorherigen Oeffnung darf beim naechsten
  // Oeffnen nicht sofort wieder als Fehler aufblitzen.
  useEffect(() => {
    if (open) {
      form.reset(defaultsFrom(player));
      updatePlayer.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `updatePlayer` ist ein neues Objekt je Render; nur `open`/`player` sollen den Effekt erneut ausloesen.
  }, [open, player]);

  const displayNameError = form.formState.errors.displayName;
  const emailError = form.formState.errors.email;

  return (
    <dialog
      aria-describedby="player-edit-description"
      aria-labelledby="player-edit-title"
      aria-modal="true"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-ring-red-deep/50 bg-slate-950 p-5 text-white shadow-2xl sm:p-6"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <form
        className="space-y-5"
        onSubmit={(event) => void form.handleSubmit((data) => updatePlayer.mutate(data))(event)}
      >
        <div>
          <h3 className="font-numerals text-title font-bold" id="player-edit-title">
            Spieler bearbeiten
          </h3>
          <p className="mt-2 text-body text-slate-300" id="player-edit-description">
            Änderungen gelten sofort für alle Ansichten dieser Organisation.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className={labelClassName} htmlFor="player-edit-first-name">Vorname</label>
            <input className={inputClassName} id="player-edit-first-name" {...form.register("firstName")} />
          </div>
          <div className="space-y-2">
            <label className={labelClassName} htmlFor="player-edit-last-name">Nachname</label>
            <input className={inputClassName} id="player-edit-last-name" {...form.register("lastName")} />
          </div>
          <div className="space-y-2">
            <label className={labelClassName} htmlFor="player-edit-display-name">Anzeigename</label>
            <input
              aria-describedby={displayNameError ? "player-edit-display-name-error" : undefined}
              aria-invalid={displayNameError ? true : undefined}
              className={inputClassName}
              id="player-edit-display-name"
              {...form.register("displayName")}
            />
            {displayNameError ? (
              <p className="text-body text-rose-300" id="player-edit-display-name-error" role="alert">
                Bitte einen Anzeigenamen angeben.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className={labelClassName} htmlFor="player-edit-nickname">Spitzname</label>
            <input className={inputClassName} id="player-edit-nickname" {...form.register("nickname")} />
          </div>
          <div className="space-y-2">
            <label className={labelClassName} htmlFor="player-edit-email">E-Mail</label>
            <input
              aria-describedby={emailError ? "player-edit-email-error" : undefined}
              aria-invalid={emailError ? true : undefined}
              className={inputClassName}
              id="player-edit-email"
              type="email"
              {...form.register("email")}
            />
            {emailError ? (
              <p className="text-body text-rose-300" id="player-edit-email-error" role="alert">
                Bitte eine gültige E-Mail-Adresse angeben.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className={labelClassName} htmlFor="player-edit-external-reference">Externe Referenz</label>
            <input
              className={inputClassName}
              id="player-edit-external-reference"
              {...form.register("externalReference")}
            />
          </div>
        </div>

        {updatePlayer.isError ? (
          <p className="text-body text-rose-300" role="alert">
            {userFacingErrorMessage(updatePlayer.error)}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Button disabled={updatePlayer.isPending} onClick={onClose} type="button" variant="outline">
            Abbrechen
          </Button>
          <Button disabled={updatePlayer.isPending} type="submit">
            Speichern
          </Button>
        </div>
      </form>
    </dialog>
  );
}
