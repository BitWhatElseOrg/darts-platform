"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { invitationPreviewSchema, type InvitationPreview } from "@darts-platform/schemas";
import { Button } from "@darts-platform/ui";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";
import { readInvitationCode } from "@/lib/invitation-link";
import { roleLabel } from "@/lib/roles";

const acceptedSchema = z.object({ accepted: z.literal(true) });
const registrationSchema = z.object({
  name: z.string().trim().min(1, "Bitte gib deinen Namen an.").max(255),
  password: z.string().min(10, "Mindestens 10 Zeichen.").max(128),
});
type RegistrationData = z.infer<typeof registrationSchema>;

const inputClassName =
  "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-body text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";
const dateFormat = new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" });

/**
 * Das Fragment ist ein Browser-Zustand ausserhalb von React, deshalb liest es
 * `useSyncExternalStore` statt eines Effects mit `setState`
 * (`react-hooks/set-state-in-effect`). Der Server-Schnappschuss ist `null`:
 * beim Server-Render und waehrend der Hydration ist noch nichts bekannt, und
 * genau dieser Zustand zeigt «Einladung wird geprüft …».
 */
function subscribeToHash(onStoreChange: () => void): () => void {
  window.addEventListener("hashchange", onStoreChange);
  return () => {
    window.removeEventListener("hashchange", onStoreChange);
  };
}

function readHash(): string {
  return window.location.hash;
}

function readServerHash(): null {
  return null;
}

/**
 * Landeseite des Einladungslinks. Der Code kommt aus dem Fragment und geht
 * nur im Body an die API. Drei Faelle nach der Vorschau: keine Sitzung
 * (registrieren und annehmen), passende Sitzung (annehmen), fremde Sitzung
 * (abmelden). Das manuelle Code-Feld auf der Startseite bleibt der Fallback.
 */
export function InvitationRoute({ invitationId }: { readonly invitationId: string }) {
  // Das Fragment gibt es nur im Browser; beim Server-Render ist es unbekannt.
  const hash = useSyncExternalStore(subscribeToHash, readHash, readServerHash);
  const code: string | null | undefined = hash === null ? undefined : readInvitationCode(hash);

  // Die Vorschau aendert sich fuer die Lebensdauer des Codes nicht. Sie darf
  // deshalb nicht neu geladen werden, wenn das Fenster den Fokus
  // zurueckbekommt (globale Voreinstellung in `providers.tsx`): wer beim
  // Ausfuellen kurz ins Mailprogramm wechselt, verlöre sonst bei einem
  // fehlgeschlagenen Neuladen das Formular samt Eingaben.
  const preview = useQuery({
    queryKey: ["invitation-preview", invitationId, code],
    enabled: typeof code === "string",
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/invitations/${invitationId}/preview`,
        method: "POST",
        body: { claimToken: code },
        schema: invitationPreviewSchema,
        signal,
      }),
  });

  if (code === undefined || (code !== null && preview.isPending)) {
    return (
      <Card title="Einladung">
        <p className="text-body text-slate-400" role="status">
          Einladung wird geprüft …
        </p>
      </Card>
    );
  }

  if (code === null) {
    return (
      <Card title="Link unvollständig">
        <p className="text-body text-slate-300">
          Dieser Einladungslink enthält keinen Code. Öffne den Link aus der E-Mail vollständig, oder gib den
          Einladungscode auf der{" "}
          <Link className="text-emerald-300 underline" href="/">
            Startseite
          </Link>{" "}
          von Hand ein.
        </p>
      </Card>
    );
  }

  // Nur eine fehlende Vorschau ersetzt die Seite. Ein Fehler bei einem
  // spaeteren Neuladen laesst den bereits geladenen Stand — und damit ein
  // ausgefuelltes Formular — stehen.
  if (preview.data === undefined) {
    return (
      <Card title="Einladung ungültig">
        <p className="text-body text-slate-300" role="alert">
          Diese Einladung ist ungültig oder abgelaufen. Bitte die einladende Person um eine neue Einladung.
        </p>
        <Link className="mt-4 inline-block text-body text-emerald-300 underline" href="/">
          Zur Startseite
        </Link>
      </Card>
    );
  }

  return <InvitationActions code={code} invitationId={invitationId} preview={preview.data} />;
}

function InvitationActions({ code, invitationId, preview }: {
  readonly code: string;
  readonly invitationId: string;
  readonly preview: InvitationPreview;
}) {
  const router = useRouter();
  const session = authClient.useSession();
  const [error, setError] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: () =>
      apiRequest({
        path: `/invitations/${invitationId}/accept`,
        method: "POST",
        body: { claimToken: code },
        schema: acceptedSchema,
      }),
    onSuccess: () => router.push("/"),
    onError: (mutationError) => setError(userFacingErrorMessage(mutationError)),
  });

  const form = useForm<RegistrationData>({
    resolver: zodResolver(registrationSchema),
    defaultValues: { name: "", password: "" },
  });

  const register = form.handleSubmit(async (data) => {
    setError(null);
    const result = await authClient.signUp.email({
      name: data.name,
      email: preview.email,
      password: data.password,
      fetchOptions: { headers: { "x-dartbase-invitation-claim": code } },
    });
    if (result.error !== null) {
      setError("Das Konto konnte nicht erstellt werden. Vielleicht existiert es bereits – melde dich dann zuerst an.");
      return;
    }
    await session.refetch();
    accept.mutate();
  });

  const nameError = form.formState.errors.name?.message;
  const passwordError = form.formState.errors.password?.message;

  const title = `Einladung zu ${preview.organizationName}`;
  const summary = (
    <p className="text-body text-slate-300">
      Du bist zu <span className="font-semibold text-white">{preview.organizationName}</span> als{" "}
      <span className="font-semibold text-white">{roleLabel(preview.role)}</span> eingeladen. Die Einladung gilt für{" "}
      <span className="font-mono text-white">{preview.email}</span> bis {dateFormat.format(preview.expiresAt)}.
    </p>
  );

  if (session.isPending) {
    return (
      <Card title={title}>
        {summary}
        <p className="mt-4 text-body text-slate-400" role="status">
          Sitzung wird geladen …
        </p>
      </Card>
    );
  }

  if (session.data !== null && session.data.user.email.toLowerCase() !== preview.email.toLowerCase()) {
    return (
      <Card title={title}>
        {summary}
        <p className="mt-4 text-body text-amber-200" role="alert">
          Du bist als {session.data.user.email} angemeldet. Melde dich ab, um die Einladung mit der eingeladenen
          Adresse anzunehmen.
        </p>
        <Button
          className="mt-4"
          onClick={() => void authClient.signOut().then(() => session.refetch())}
          type="button"
          variant="outline"
        >
          Abmelden
        </Button>
      </Card>
    );
  }

  if (session.data !== null) {
    return (
      <Card title={title}>
        {summary}
        {error !== null ? (
          <p className="mt-4 rounded-lg bg-rose-400/10 p-3 text-body text-rose-200" role="alert">
            {error}
          </p>
        ) : null}
        <Button className="mt-4 w-full" disabled={accept.isPending} onClick={() => accept.mutate()} type="button">
          Einladung annehmen
        </Button>
      </Card>
    );
  }

  return (
    <Card title={title}>
      {summary}
      <form autoComplete="on" className="mt-6 space-y-4" onSubmit={(event) => void register(event)}>
        {/*
          Die Feldmeldung steht ausserhalb des `<label>`: im Label waere sie
          Teil des Feldnamens. Sie traegt `role="alert"` und haengt ueber
          `aria-describedby` am Feld, damit sie angesagt wird.
        */}
        <div className="space-y-2">
          <label className="block space-y-2 text-body text-slate-300">
            <span>Name</span>
            <input
              aria-describedby={nameError === undefined ? undefined : "invitation-name-error"}
              aria-invalid={nameError !== undefined}
              autoComplete="name"
              className={inputClassName}
              {...form.register("name")}
            />
          </label>
          {nameError === undefined ? null : (
            <p className="text-caption text-rose-300" id="invitation-name-error" role="alert">
              {nameError}
            </p>
          )}
        </div>
        <label className="block space-y-2 text-body text-slate-300">
          <span>E-Mail</span>
          <input
            autoComplete="username"
            className={`${inputClassName} text-slate-400`}
            readOnly
            type="email"
            value={preview.email}
          />
        </label>
        <div className="space-y-2">
          <label className="block space-y-2 text-body text-slate-300">
            <span>Passwort</span>
            <input
              aria-describedby={passwordError === undefined ? undefined : "invitation-password-error"}
              aria-invalid={passwordError !== undefined}
              autoComplete="new-password"
              className={inputClassName}
              type="password"
              {...form.register("password")}
            />
          </label>
          {passwordError === undefined ? null : (
            <p className="text-caption text-rose-300" id="invitation-password-error" role="alert">
              {passwordError}
            </p>
          )}
        </div>
        {error !== null ? (
          <p className="rounded-lg bg-rose-400/10 p-3 text-body text-rose-200" role="alert">
            {error}
          </p>
        ) : null}
        <Button className="w-full" disabled={form.formState.isSubmitting || accept.isPending} type="submit">
          {form.formState.isSubmitting || accept.isPending
            ? "Bitte warten …"
            : "Konto erstellen und Einladung annehmen"}
        </Button>
      </form>
      <p className="mt-5 text-body text-slate-400">
        Du hast schon ein Konto mit dieser Adresse?{" "}
        <Link className="text-emerald-300 underline" href="/">
          Melde dich an
        </Link>{" "}
        und öffne den Link danach erneut.
      </p>
    </Card>
  );
}

function Card({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-black/20 sm:p-8">
      <h1 className="font-numerals text-title font-bold text-white">{title}</h1>
      <div className="mt-4">{children}</div>
    </section>
  );
}
