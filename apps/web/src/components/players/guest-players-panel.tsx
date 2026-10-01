"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import {
  createGuestPlayersSchema,
  playerListSchema,
  type CreateGuestPlayersInput,
  type PlayerResponse,
} from "@darts-platform/schemas";
import { Control, Field, Rule, SheetLabel, TextInput, Wedge } from "@darts-platform/ui";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { generateId } from "@/lib/id";

/**
 * Dieselben Klassen wie `TextInput` in `packages/ui/src/sektorenring/field.tsx`
 * (dort nicht exportiert), nur mit Platz für mehrere Zeilen.
 */
const textareaClassName = [
  "min-h-32 w-full rounded-lg border border-sisal-400 bg-sisal-50 px-3 py-2 font-plate text-field text-wedge-900",
  "placeholder:text-sisal-500 focus:border-ring-green",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green",
  "disabled:cursor-not-allowed disabled:bg-sisal-100 disabled:text-sisal-500",
].join(" ");

interface GuestPlayersFormValues {
  readonly clubName: string;
  readonly namesText: string;
}

/** Leere Zeilen fallen weg, jeder Name wird getrimmt. */
function parseNames(namesText: string): string[] {
  return namesText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Übersetzt die erste Zod-Meldung in einen Text, der das Problem und den
 * Ausweg nennt. Doppelte Namen meldet die Refine-Regel des Schemas auf dem
 * Pfad `["names"]` mit dem Code `custom`.
 */
function formErrors(
  issues: readonly { readonly path: readonly PropertyKey[]; readonly code: string }[],
): { clubName?: string; namesText?: string } {
  const errors: { clubName?: string; namesText?: string } = {};
  for (const issue of issues) {
    const [field] = issue.path;
    if (field === "clubName" && errors.clubName === undefined) {
      errors.clubName =
        issue.code === "too_big"
          ? "Der Vereinsname darf höchstens 120 Zeichen lang sein."
          : "Bitte den Verein der Gäste angeben.";
    } else if (field === "names" && errors.namesText === undefined) {
      if (issue.path.length > 1) {
        errors.namesText = "Ein Name darf höchstens 255 Zeichen lang sein.";
      } else if (issue.code === "too_small") {
        errors.namesText = "Mindestens einen Namen eingeben.";
      } else if (issue.code === "too_big") {
        errors.namesText = "Höchstens 64 Namen auf einmal erfassen.";
      } else {
        errors.namesText = "Jeder Name darf nur einmal vorkommen.";
      }
    }
  }
  return errors;
}

/**
 * Gastspieler eines anderen Vereins in einem Schritt erfassen (Spec
 * Vereinsduell). Die commandId bleibt bis zum Erfolg dieselbe: eine
 * Wiederholung nach einem Netzfehler legt keine Dubletten an (AGENTS.md §11).
 * Sie gilt aber nur für genau diese Eingabe: der Server beantwortet eine
 * bekannte commandId mit dem früheren Ergebnis, eine geänderte Liste unter
 * derselben Id ginge also stillschweigend verloren.
 */
export function GuestPlayersPanel({
  clubName,
  onCreated,
  organizationId,
}: {
  readonly organizationId: string;
  /** Vorbelegt aus dem Gastverein-Feld, hier änderbar. */
  readonly clubName: string;
  readonly onCreated: (players: readonly PlayerResponse[]) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<GuestPlayersFormValues>({ defaultValues: { clubName, namesText: "" } });
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef<{ readonly commandId: string; readonly payload: string } | null>(null);

  // Solange niemand den Verein hier angefasst hat, folgt er dem
  // Gastverein-Feld der Elternansicht.
  const clubNameDirty = form.formState.dirtyFields.clubName === true;
  useEffect(() => {
    if (!clubNameDirty) {
      form.setValue("clubName", clubName);
    }
  }, [clubName, clubNameDirty, form]);

  const createGuests = useMutation({
    mutationFn: (body: CreateGuestPlayersInput) =>
      apiRequest({
        path: `/organizations/${organizationId}/players/guests`,
        method: "POST",
        body,
        schema: playerListSchema,
      }),
    onSuccess: (players) => {
      pending.current = null;
      form.resetField("namesText", { defaultValue: "" });
      setNotice(`${players.length} Gastspieler erfasst.`);
      // Trifft auch ["players", organizationId, "ALL"].
      void queryClient.invalidateQueries({ queryKey: ["players", organizationId] });
      onCreated(players);
    },
  });

  function createFromForm(values: GuestPlayersFormValues) {
    // Alte Erfolgs- oder Netzfehlermeldungen gehören nicht neben eine neue Eingabe.
    setNotice(null);
    createGuests.reset();
    const names = parseNames(values.namesText);
    const payload = JSON.stringify([values.clubName.trim(), names]);
    if (pending.current?.payload !== payload) {
      pending.current = { commandId: generateId(), payload };
    }
    const parsed = createGuestPlayersSchema.safeParse({
      commandId: pending.current.commandId,
      clubName: values.clubName,
      names,
    });
    if (!parsed.success) {
      const errors = formErrors(parsed.error.issues);
      // Der Fokus springt auf das erste fehlerhafte Feld (Tastatur, Screenreader).
      if (errors.clubName) form.setError("clubName", { message: errors.clubName }, { shouldFocus: true });
      if (errors.namesText) {
        form.setError("namesText", { message: errors.namesText }, { shouldFocus: errors.clubName === undefined });
      }
      return;
    }
    createGuests.mutate(parsed.data);
  }

  const clubError = form.formState.errors.clubName?.message ?? null;
  const namesError = form.formState.errors.namesText?.message ?? null;

  return (
    <Wedge className="p-4" tone="plate">
      <SheetLabel as="h3">Gastspieler erfassen</SheetLabel>
      <Rule className="mt-2" tone="faint" />
      <form className="mt-3 grid gap-3" noValidate onSubmit={(event) => void form.handleSubmit(createFromForm)(event)}>
        <Field error={clubError} htmlFor="guest-club" label="Verein der Gäste">
          <TextInput
            aria-describedby={clubError ? "guest-club-error" : undefined}
            aria-invalid={clubError ? true : undefined}
            id="guest-club"
            {...form.register("clubName")}
          />
        </Field>
        <Field
          error={namesError}
          hint="Leere Zeilen werden übersprungen."
          htmlFor="guest-names"
          label="Gastspieler (ein Name pro Zeile)"
        >
          <textarea
            aria-describedby={namesError ? "guest-names-error" : "guest-names-hint"}
            aria-invalid={namesError ? true : undefined}
            className={textareaClassName}
            id="guest-names"
            {...form.register("namesText")}
          />
        </Field>
        <Control disabled={createGuests.isPending} type="submit" variant="plate">
          Gastspieler erfassen
        </Control>
        {createGuests.error ? (
          <p className="font-plate text-caption text-ring-red-deep" role="alert">
            {userFacingErrorMessage(createGuests.error)}
          </p>
        ) : null}
        <p aria-live="polite" className="font-plate text-caption text-sisal-500" role="status">
          {notice ?? ""}
        </p>
      </form>
    </Wedge>
  );
}
