"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@darts-platform/ui";

import { authClient } from "@/lib/auth-client";

const schema = z
  .object({
    password: z.string().min(10, "Mindestens 10 Zeichen.").max(128),
    confirmation: z.string(),
  })
  .refine((value) => value.password === value.confirmation, {
    message: "Die Passwörter stimmen nicht überein.",
    path: ["confirmation"],
  });
type FormData = z.infer<typeof schema>;

const inputClassName =
  "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-body text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";

interface ResetPasswordRouteProps {
  readonly token: string | null;
  readonly invalid: boolean;
}

/**
 * Setzt das Passwort mit dem Token aus dem Query-String, das Better Auth
 * nach dem Klick auf den Mail-Link dorthin schreibt. Ohne Token oder mit
 * `error=INVALID_TOKEN` fuehrt die Seite zurueck zur Anforderung.
 */
export function ResetPasswordRoute({ token, invalid }: ResetPasswordRouteProps) {
  const [state, setState] = useState<"form" | "done" | "error">("form");
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmation: "" },
  });

  const submit = form.handleSubmit(async (data) => {
    if (token === null) {
      return;
    }
    const result = await authClient.resetPassword({ newPassword: data.password, token });
    setState(result.error === null ? "done" : "error");
  });

  const passwordError = form.formState.errors.password?.message;
  const confirmationError = form.formState.errors.confirmation?.message;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-black/20 sm:p-8">
      <h1 className="font-numerals text-title font-bold text-white">Neues Passwort</h1>
      {token === null || invalid || state === "error" ? (
        <div className="mt-4 space-y-4">
          <p className="text-body text-slate-300" role="alert">
            Dieser Link ist ungültig oder abgelaufen. Fordere einen neuen Link an.
          </p>
          <Link className="inline-block text-body text-emerald-300 underline" href="/passwort/vergessen">
            Passwort vergessen
          </Link>
        </div>
      ) : state === "done" ? (
        <div className="mt-4 space-y-4">
          <p className="text-body text-slate-300" role="status">
            Dein Passwort ist gesetzt. Alle bisherigen Sitzungen wurden beendet.
          </p>
          <Link className="inline-block text-body text-emerald-300 underline" href="/">
            Zur Anmeldung
          </Link>
        </div>
      ) : (
        <form autoComplete="on" className="mt-4 space-y-4" onSubmit={(event) => void submit(event)}>
          {/*
            Die Feldmeldungen stehen ausserhalb der `<label>`: im Label waeren
            sie Teil des Feldnamens. Sie tragen `role="alert"` und haengen
            ueber `aria-describedby` am Feld, damit sie angesagt werden.
          */}
          <div className="space-y-2">
            <label className="block space-y-2 text-body text-slate-300">
              <span>Neues Passwort</span>
              <input
                aria-describedby={passwordError === undefined ? undefined : "reset-password-error"}
                aria-invalid={passwordError !== undefined}
                autoComplete="new-password"
                className={inputClassName}
                type="password"
                {...form.register("password")}
              />
            </label>
            {passwordError === undefined ? null : (
              <p className="text-caption text-rose-300" id="reset-password-error" role="alert">
                {passwordError}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label className="block space-y-2 text-body text-slate-300">
              <span>Passwort wiederholen</span>
              <input
                aria-describedby={confirmationError === undefined ? undefined : "reset-confirmation-error"}
                aria-invalid={confirmationError !== undefined}
                autoComplete="new-password"
                className={inputClassName}
                type="password"
                {...form.register("confirmation")}
              />
            </label>
            {confirmationError === undefined ? null : (
              <p className="text-caption text-rose-300" id="reset-confirmation-error" role="alert">
                {confirmationError}
              </p>
            )}
          </div>
          <Button className="w-full" disabled={form.formState.isSubmitting} type="submit">
            {form.formState.isSubmitting ? "Bitte warten …" : "Passwort setzen"}
          </Button>
        </form>
      )}
    </section>
  );
}
