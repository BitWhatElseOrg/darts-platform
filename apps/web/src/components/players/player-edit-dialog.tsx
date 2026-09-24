"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef } from "react";
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

  // Nur beim UEBERGANG geschlossen->offen vorbelegen, nicht bei jeder
  // Aenderung von `player` waehrend der Dialog offen ist: die Spielerliste
  // steht in TanStack Query (`staleTime` 5000, `refetchOnWindowFocus`), ein
  // Hintergrund-Refetch kann waehrend der Eingabe ein neues, aber
  // inhaltlich gleiches `player`-Objekt liefern. Ein Reset auf jede
  // `player`-Referenzaenderung wuerde dann unbemerkt ungespeicherte
  // Eingaben verwerfen (AGENTS.md §18, "kein versteckter Datenverlust").
  // `player` bewusst NICHT in den Dependencies: der Effekt soll nur auf den
  // Uebergang reagieren, dabei aber den `player`-Stand des Renders lesen, in
  // dem `open` gerade wahr wurde.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (justOpened) {
      form.reset(defaultsFrom(player));
      updatePlayer.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- absichtlich nur `open`: siehe Kommentar oben.
  }, [open]);

  const displayNameError = form.formState.errors.displayName;
  const emailError = form.formState.errors.email;

  // Eindeutig je Zeile: `PlayerRow` mountet pro Spieler dauerhaft eine
  // eigene Instanz (siehe `confirm-dialog.tsx`), statische IDs wuerden bei
  // mehr als einem Spieler dupliziert und `aria-labelledby`/
  // `aria-describedby`/`<label htmlFor>` liessen sich dann nicht mehr
  // zuverlaessig der tatsaechlich offenen Instanz zuordnen.
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const firstNameId = `${baseId}-first-name`;
  const lastNameId = `${baseId}-last-name`;
  const displayNameId = `${baseId}-display-name`;
  const displayNameErrorId = `${baseId}-display-name-error`;
  const nicknameId = `${baseId}-nickname`;
  const emailId = `${baseId}-email`;
  const emailErrorId = `${baseId}-email-error`;
  const externalReferenceId = `${baseId}-external-reference`;

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
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
          <h3 className="font-numerals text-title font-bold" id={titleId}>
            Spieler bearbeiten
          </h3>
          <p className="mt-2 text-body text-slate-300" id={descriptionId}>
            Änderungen gelten sofort für alle Ansichten dieser Organisation.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className={labelClassName} htmlFor={firstNameId}>Vorname</label>
            <input className={inputClassName} id={firstNameId} {...form.register("firstName")} />
          </div>
          <div className="space-y-2">
            <label className={labelClassName} htmlFor={lastNameId}>Nachname</label>
            <input className={inputClassName} id={lastNameId} {...form.register("lastName")} />
          </div>
          <div className="space-y-2">
            <label className={labelClassName} htmlFor={displayNameId}>Anzeigename</label>
            <input
              aria-describedby={displayNameError ? displayNameErrorId : undefined}
              aria-invalid={displayNameError ? true : undefined}
              className={inputClassName}
              id={displayNameId}
              {...form.register("displayName")}
            />
            {displayNameError ? (
              <p className="text-body text-rose-300" id={displayNameErrorId} role="alert">
                Bitte einen Anzeigenamen angeben.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className={labelClassName} htmlFor={nicknameId}>Spitzname</label>
            <input className={inputClassName} id={nicknameId} {...form.register("nickname")} />
          </div>
          <div className="space-y-2">
            <label className={labelClassName} htmlFor={emailId}>E-Mail</label>
            <input
              aria-describedby={emailError ? emailErrorId : undefined}
              aria-invalid={emailError ? true : undefined}
              className={inputClassName}
              id={emailId}
              type="email"
              {...form.register("email")}
            />
            {emailError ? (
              <p className="text-body text-rose-300" id={emailErrorId} role="alert">
                Bitte eine gültige E-Mail-Adresse angeben.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className={labelClassName} htmlFor={externalReferenceId}>Externe Referenz</label>
            <input
              className={inputClassName}
              id={externalReferenceId}
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
