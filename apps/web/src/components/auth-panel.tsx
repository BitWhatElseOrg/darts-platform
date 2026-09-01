"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@darts-platform/ui";

import { authClient } from "@/lib/auth-client";

const authFormSchema = z.object({
  name: z.string().trim().max(255),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(10).max(128),
  invitationClaim: z.string().trim(),
});

type AuthFormData = z.infer<typeof authFormSchema>;

interface AuthPanelProps {
  readonly onAuthenticated: () => Promise<void>;
}

const inputClassName =
  "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";

export function AuthPanel({ onAuthenticated }: AuthPanelProps) {
  const [mode, setMode] = useState<"sign-in" | "register">("sign-in");
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<AuthFormData>({
    resolver: zodResolver(authFormSchema),
    defaultValues: { name: "", email: "", password: "", invitationClaim: "" },
  });

  const submit = form.handleSubmit(async (data) => {
    setServerError(null);

    const result =
      mode === "register"
        ? await authClient.signUp.email({
            name: data.name,
            email: data.email,
            password: data.password,
            fetchOptions: {
              headers: {
                "x-dartbase-invitation-claim": data.invitationClaim,
              },
            },
          })
        : await authClient.signIn.email({
            email: data.email,
            password: data.password,
          });

    if (result.error !== null) {
      setServerError(
        mode === "sign-in"
          ? "E-Mail oder Passwort ist nicht korrekt."
          : "Das Konto konnte nicht erstellt werden. Prüfe E-Mail-Adresse und Einladungscode.",
      );
      return;
    }

    form.reset();
    await onAuthenticated();
  });

  return (
    <section className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-black/20 sm:p-8">
      <div className="mb-6">
        <p className="mb-1 text-xs font-semibold tracking-[0.2em] text-emerald-300 uppercase">
          Benutzerkonto
        </p>
        <h2 className="text-2xl font-semibold text-white">
          {mode === "sign-in" ? "Anmelden" : "Konto erstellen"}
        </h2>
        {mode === "register" ? (
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Die Registrierung ist nur mit einer gültigen Einladung möglich.
          </p>
        ) : null}
      </div>

      <form autoComplete="on" className="space-y-4" onSubmit={(event) => void submit(event)}>
        {mode === "register" ? (
          <>
            <label className="block space-y-2 text-sm text-slate-300">
              <span>Name</span>
              <input
                className={inputClassName}
                autoComplete="name"
                {...form.register("name")}
              />
            </label>
            <label className="block space-y-2 text-sm text-slate-300">
              <span>Einladungscode</span>
              <input
                className={`${inputClassName} font-mono`}
                autoComplete="off"
                required
                {...form.register("invitationClaim")}
              />
            </label>
          </>
        ) : null}

        <label className="block space-y-2 text-sm text-slate-300">
          <span>E-Mail</span>
          <input
            id="auth-email"
            className={inputClassName}
            type="email"
            autoComplete="username"
            {...form.register("email")}
          />
        </label>

        <label className="block space-y-2 text-sm text-slate-300">
          <span>Passwort</span>
          <input
            id="auth-password"
            className={inputClassName}
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            {...form.register("password")}
          />
        </label>

        {serverError !== null ? (
          <p role="alert" className="rounded-lg bg-rose-400/10 p-3 text-sm text-rose-200">
            {serverError}
          </p>
        ) : null}

        <Button className="w-full" disabled={form.formState.isSubmitting} type="submit">
          {form.formState.isSubmitting
            ? "Bitte warten …"
            : mode === "sign-in"
              ? "Anmelden"
              : "Konto erstellen"}
        </Button>
      </form>

      <button
        className="mt-5 min-h-11 w-full text-sm font-medium text-emerald-300 hover:text-emerald-200"
        onClick={() => {
          setMode((current) => (current === "sign-in" ? "register" : "sign-in"));
          setServerError(null);
        }}
        type="button"
      >
        {mode === "sign-in"
          ? "Eingeladen? Konto erstellen"
          : "Bereits registriert? Anmelden"}
      </button>
    </section>
  );
}
