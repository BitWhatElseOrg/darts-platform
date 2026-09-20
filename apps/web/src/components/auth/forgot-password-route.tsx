"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@darts-platform/ui";

import { authClient } from "@/lib/auth-client";

const schema = z.object({
  email: z.email("Bitte gib eine gültige E-Mail-Adresse an.").trim().toLowerCase(),
});
type FormData = z.infer<typeof schema>;

const inputClassName =
  "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-body text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";

/**
 * Fordert den Reset-Link an. Die Bestaetigung ist immer dieselbe — ob ein
 * Konto existiert, verraet die Seite nicht (Better Auth antwortet gleich).
 */
export function ForgotPasswordRoute() {
  const [state, setState] = useState<"form" | "sent" | "error">("form");
  const form = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  const submit = form.handleSubmit(async (data) => {
    const result = await authClient.requestPasswordReset({
      email: data.email,
      redirectTo: `${window.location.origin}/passwort/neu`,
    });
    setState(result.error === null ? "sent" : "error");
  });

  const emailError = form.formState.errors.email?.message;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-black/20 sm:p-8">
      <h1 className="font-numerals text-title font-bold text-white">Passwort vergessen</h1>
      {state === "sent" ? (
        <p className="mt-4 text-body text-slate-300" role="status">
          Wenn ein Konto mit dieser Adresse existiert, ist eine E-Mail mit einem Link unterwegs. Der Link ist eine
          Stunde gültig.
        </p>
      ) : (
        <form className="mt-4 space-y-4" onSubmit={(event) => void submit(event)}>
          <p className="text-body text-slate-400">
            Gib die E-Mail-Adresse deines Kontos an. Du erhältst einen Link, um ein neues Passwort zu setzen.
          </p>
          {/*
            Die Feldmeldung steht ausserhalb des `<label>`: im Label waere sie
            Teil des Feldnamens. Sie traegt `role="alert"` und haengt ueber
            `aria-describedby` am Feld, damit sie angesagt wird.
          */}
          <div className="space-y-2">
            <label className="block space-y-2 text-body text-slate-300">
              <span>E-Mail</span>
              <input
                aria-describedby={emailError === undefined ? undefined : "forgot-password-email-error"}
                aria-invalid={emailError !== undefined}
                autoComplete="username"
                className={inputClassName}
                type="email"
                {...form.register("email")}
              />
            </label>
            {emailError === undefined ? null : (
              <p className="text-caption text-rose-300" id="forgot-password-email-error" role="alert">
                {emailError}
              </p>
            )}
          </div>
          {state === "error" ? (
            <p className="rounded-lg bg-rose-400/10 p-3 text-body text-rose-200" role="alert">
              Die Anfrage ist fehlgeschlagen. Versuche es in einer Minute erneut.
            </p>
          ) : null}
          <Button className="w-full" disabled={form.formState.isSubmitting} type="submit">
            {form.formState.isSubmitting ? "Bitte warten …" : "Link anfordern"}
          </Button>
        </form>
      )}
      <Link className="mt-5 inline-block text-body text-emerald-300 underline" href="/">
        Zur Anmeldung
      </Link>
    </section>
  );
}
