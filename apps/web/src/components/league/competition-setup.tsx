"use client";

import { useMutation } from "@tanstack/react-query";
import {
  competitionDetailSchema,
  createCompetitionSchema,
  type CreateCompetitionInput,
  type OrganizationSummary,
} from "@darts-platform/schemas";
import { hasOrganizationPermission } from "@darts-platform/domain";
import { buildEncounterTemplate, type StartingScore } from "@darts-platform/league-engine";
import { Control, Field, Rule, SelectInput, SheetLabel, TextInput, Wedge } from "@darts-platform/ui";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import {
  competitionFormErrors,
  deciderReachability,
  legDistanceHint,
  lineupPositionsHint,
} from "@/lib/competition-form";
import { slugFromName } from "@/lib/league-template";
import { TemplateTable } from "./template-table";
import { NavLink, PageNav } from "@/components/page-nav";
import { useTournamentOrganization } from "@/components/tournament/use-tournament-organization";

/**
 * Formularwerte sind Zeichenketten; `createCompetitionSchema` entscheidet beim
 * Absenden. Die Vorlage wird nicht getippt, sondern aus den Eckwerten erzeugt
 * und darunter gezeigt — die League-Engine prüft sie serverseitig erneut.
 */
interface SetupFormValues {
  readonly name: string;
  readonly slug: string;
  readonly lineupPositions: string;
  readonly regularDoubles: string;
  readonly decider: "EXTRA_SLOT" | "NONE";
  readonly singlesStartingScore: string;
  readonly doublesStartingScore: string;
  readonly inRule: "STRAIGHT" | "DOUBLE";
  readonly outRule: "SINGLE" | "DOUBLE" | "MASTER";
  readonly bestOfLegs: string;
  readonly maxRounds: string;
  readonly pointsWin: string;
  readonly pointsDraw: string;
  readonly pointsLoss: string;
  readonly pointsDeciderBonus: string;
  readonly minNominations: string;
  readonly minNominationsShorthanded: string;
  readonly maxSubstitutionsPerEncounter: string;
  readonly maxDoublesPerPlayer: string;
}


function startingScore(value: string): StartingScore {
  return value === "301" ? 301 : value === "701" ? 701 : 501;
}

export function CompetitionSetup({
  requestedOrganizationId,
}: {
  readonly requestedOrganizationId: string | undefined;
}) {
  const { query, organization } = useTournamentOrganization(requestedOrganizationId);

  return (
    <main className="sektorenring min-h-screen">
      <div className="mx-auto max-w-[1100px] px-5 py-8 xl:px-9">
        <PageNav>
          <NavLink href={organization === null ? "/liga" : `/liga?organisation=${organization.id}`}>
            Alle Wettbewerbe
          </NavLink>
        </PageNav>

        <h1 className="font-numerals text-headline font-bold text-wedge-900">
          Wettbewerb anlegen
        </h1>
        <p className="mt-1.5 max-w-[65ch] prose-de font-plate text-body text-sisal-500">
          Die Eckwerte erzeugen die Begegnungsvorlage: die Einzel bilden ein vollständiges
          Rundenturnier über alle Aufstellungspositionen, die Doppel folgen nach der halben Distanz.
        </p>

        <Rule className="mt-6" />

        {query.isPending ? (
          <Notice>Organisation wird geladen …</Notice>
        ) : organization === null ? (
          <Notice>Lege zuerst auf der Startseite eine Organisation an.</Notice>
        ) : !hasOrganizationPermission(organization.role, "competition:manage") ? (
          <Notice>
            Deine Rolle liest Wettbewerbe, legt aber keine an. Die Turnierleitung dieser Organisation
            richtet den Ligabetrieb ein.
          </Notice>
        ) : (
          <SetupForm organization={organization} />
        )}
      </div>
    </main>
  );
}

/**
 * Der Feldname des Zod-Pfads, übersetzt in die Kennung des Eingabefelds. Ohne
 * diese Zuordnung fände der Sprung zum Fehler nichts.
 */
const fieldIds: Readonly<Record<string, string>> = {
  name: "competition-name",
  slug: "competition-slug",
  lineupPositions: "lineup-positions",
  minNominations: "min-nominations",
  minNominationsShorthanded: "min-nominations-shorthanded",
  pointsWin: "points-win",
  pointsDraw: "points-draw",
  pointsLoss: "points-loss",
  pointsDeciderBonus: "points-decider-bonus",
  maxSubstitutionsPerEncounter: "max-substitutions",
  maxDoublesPerPlayer: "max-doubles",
  slots: "template-heading",
};

function focusFirstError(fields: readonly string[]): void {
  for (const field of fields) {
    const id = fieldIds[field];
    if (id === undefined) continue;
    const element = document.getElementById(id);
    if (element === null) continue;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    if (element instanceof HTMLElement) element.focus({ preventScroll: true });
    return;
  }
}

function SetupForm({ organization }: { readonly organization: OrganizationSummary }) {
  const router = useRouter();
  const [formErrors, setFormErrors] = useState<Readonly<Record<string, string>>>({});
  const [slugTouched, setSlugTouched] = useState(false);
  const { control, handleSubmit, register, setValue } = useForm<SetupFormValues>({
    defaultValues: {
      name: "",
      slug: "",
      lineupPositions: "4",
      regularDoubles: "2",
      decider: "EXTRA_SLOT",
      singlesStartingScore: "501",
      doublesStartingScore: "701",
      inRule: "DOUBLE",
      outRule: "DOUBLE",
      bestOfLegs: "3",
      maxRounds: "",
      pointsWin: "3",
      pointsDraw: "1",
      pointsLoss: "0",
      pointsDeciderBonus: "1",
      minNominations: "4",
      minNominationsShorthanded: "3",
      maxSubstitutionsPerEncounter: "4",
      maxDoublesPerPlayer: "1",
    },
  });
  const values = useWatch({ control });

  const slots = useMemo(
    () =>
      buildEncounterTemplate({
        lineupPositions: Number(values.lineupPositions ?? "4"),
        regularDoubles: Number(values.regularDoubles ?? "2"),
        withDecider: (values.decider ?? "EXTRA_SLOT") === "EXTRA_SLOT",
        singlesStartingScore: startingScore(values.singlesStartingScore ?? "501"),
        doublesStartingScore: startingScore(values.doublesStartingScore ?? "701"),
        inRule: values.inRule ?? "DOUBLE",
        outRule: values.outRule ?? "DOUBLE",
        bestOfLegs: Number(values.bestOfLegs ?? "3"),
        maxRounds: (values.maxRounds ?? "").trim() === "" ? null : Number(values.maxRounds),
      }),
    [
      values.bestOfLegs,
      values.decider,
      values.doublesStartingScore,
      values.inRule,
      values.lineupPositions,
      values.maxRounds,
      values.outRule,
      values.regularDoubles,
      values.singlesStartingScore,
    ],
  );

  const createCompetition = useMutation({
    mutationFn: (data: CreateCompetitionInput) =>
      apiRequest({
        path: `/organizations/${organization.id}/competitions`,
        method: "POST",
        body: data,
        schema: competitionDetailSchema,
      }),
    onSuccess: (competition) =>
      router.push(`/liga/${competition.id}?organisation=${organization.id}`),
  });

  function onSubmit(formValues: SetupFormValues) {
    const withDecider = formValues.decider === "EXTRA_SLOT";
    const parsed = createCompetitionSchema.safeParse({
      type: "LEAGUE",
      name: formValues.name,
      slug: formValues.slug,
      status: "ACTIVE",
      pointsWin: Number(formValues.pointsWin),
      pointsDraw: Number(formValues.pointsDraw),
      pointsLoss: Number(formValues.pointsLoss),
      // Ohne Entscheidungsdoppel gibt es keinen Zusatzpunkt; das ist die
      // Check-Constraint der Tabelle, hier als Bedienung ausgedrückt.
      pointsDeciderBonus: withDecider ? Number(formValues.pointsDeciderBonus) : 0,
      deciderRule: withDecider ? "EXTRA_SLOT" : "NONE",
      lineupPositions: Number(formValues.lineupPositions),
      minNominations: Number(formValues.minNominations),
      minNominationsShorthanded: Number(formValues.minNominationsShorthanded),
      maxSubstitutionsPerEncounter: Number(formValues.maxSubstitutionsPerEncounter),
      maxDoublesPerPlayer: Number(formValues.maxDoublesPerPlayer),
      slots,
    });
    if (!parsed.success) {
      const next = competitionFormErrors(parsed.error.issues, {
        lineupPositions: Number(formValues.lineupPositions),
      });
      setFormErrors(next);
      // Die Schaltfläche steht unten, die fehlerhafte Angabe oft weit oben.
      // Ohne diesen Sprung sieht die Bedienung nur, dass nichts passiert.
      focusFirstError(Object.keys(next));
      return;
    }
    setFormErrors({});
    createCompetition.mutate(parsed.data);
  }

  const withDecider = (values.decider ?? "EXTRA_SLOT") === "EXTRA_SLOT";
  const deciderWarning = deciderReachability({
    lineupPositions: Number(values.lineupPositions ?? "4"),
    regularDoubles: Number(values.regularDoubles ?? "2"),
    withDecider,
  });
  const errorSummary = Object.entries(formErrors).map(([field, message]) => ({ field, message }));

  return (
    <form className="mt-7 flex flex-col gap-9" onSubmit={handleSubmit(onSubmit)}>
      {createCompetition.error ? (
        <Wedge className="p-4" tone="alarm">
          <SheetLabel as="h2" tone="alarm">
            Wettbewerb nicht angelegt
          </SheetLabel>
          <p className="mt-1.5 font-plate text-body text-wedge-900">
            {userFacingErrorMessage(createCompetition.error)}
          </p>
        </Wedge>
      ) : null}

      <section aria-labelledby="competition-heading">
        <SheetLabel as="h2" id="competition-heading">
          Wettbewerb
        </SheetLabel>
        <Rule className="mt-2" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field error={formErrors.name ?? null} htmlFor="competition-name" label="Name">
            <TextInput
              aria-describedby={formErrors.name ? "competition-name-error" : undefined}
              id="competition-name"
              placeholder="Gruppe STSO S 2"
              {...register("name", {
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                  if (!slugTouched) setValue("slug", slugFromName(event.target.value));
                },
              })}
            />
          </Field>
          <Field
            error={formErrors.slug ?? null}
            hint="Erscheint in Adressen und Tabellen."
            htmlFor="competition-slug"
            label="Kurzname"
          >
            <TextInput
              aria-describedby={formErrors.slug ? "competition-slug-error" : undefined}
              id="competition-slug"
              placeholder="stso-s-2"
              {...register("slug", { onChange: () => setSlugTouched(true) })}
            />
          </Field>
        </div>
      </section>

      <section aria-labelledby="mode-heading">
        <SheetLabel as="h2" id="mode-heading">
          Modus
        </SheetLabel>
        <Rule className="mt-2" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            hint={lineupPositionsHint(Number(values.lineupPositions ?? "4"))}
            htmlFor="lineup-positions"
            label="Aufstellungspositionen"
          >
            <SelectInput id="lineup-positions" {...register("lineupPositions")}>
              {[2, 3, 4, 5, 6].map((count) => (
                <option key={count} value={String(count)}>
                  {count}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field
            hint="Reglement 2.2.1/A1.1 sehen zwei Doppel vor; eine ungerade Zahl macht das 9:9 aus 2.2.2/A1.4 unmöglich."
            htmlFor="regular-doubles"
            label="Reguläre Doppel"
          >
            <SelectInput id="regular-doubles" {...register("regularDoubles")}>
              {[2, 4].map((count) => (
                <option key={count} value={String(count)}>
                  {count}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field
            hint="Reglement 2.2.2: bei Gleichstand entscheidet ein Doppel."
            htmlFor="decider"
            label="Entscheidungsdoppel"
          >
            <SelectInput id="decider" {...register("decider")}>
              <option value="EXTRA_SLOT">bei Gleichstand austragen</option>
              <option value="NONE">kein Entscheidungsdoppel</option>
            </SelectInput>
          </Field>
          <Field
            hint={legDistanceHint(Number(values.bestOfLegs ?? "3"))}
            htmlFor="best-of-legs"
            label="Distanz je Spiel"
          >
            <SelectInput id="best-of-legs" {...register("bestOfLegs")}>
              {[1, 3, 5, 7, 9].map((count) => (
                <option key={count} value={String(count)}>
                  Best of {count}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field htmlFor="singles-score" label="Startscore Einzel">
            <SelectInput id="singles-score" {...register("singlesStartingScore")}>
              {["301", "501", "701"].map((score) => (
                <option key={score} value={score}>
                  {score}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field htmlFor="doubles-score" label="Startscore Doppel">
            <SelectInput id="doubles-score" {...register("doublesStartingScore")}>
              {["301", "501", "701"].map((score) => (
                <option key={score} value={score}>
                  {score}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field hint="Reglement 1.1 kennt vier Varianten." htmlFor="in-rule" label="In-Regel">
            <SelectInput id="in-rule" {...register("inRule")}>
              <option value="STRAIGHT">Straight In</option>
              <option value="DOUBLE">Double In</option>
            </SelectInput>
          </Field>
          <Field htmlFor="out-rule" label="Out-Regel">
            <SelectInput id="out-rule" {...register("outRule")}>
              <option value="SINGLE">Single Out</option>
              <option value="DOUBLE">Double Out</option>
              <option value="MASTER">Master Out</option>
            </SelectInput>
          </Field>
          <Field
            hint="Anhang 2: leer lassen, wenn kein Automatenlimit gilt."
            htmlFor="max-rounds"
            label="Rundenbegrenzung"
          >
            <TextInput
              id="max-rounds"
              inputMode="numeric"
              placeholder="ohne"
              {...register("maxRounds")}
            />
          </Field>
        </div>
      </section>

      <section aria-labelledby="rules-heading">
        <SheetLabel as="h2" id="rules-heading">
          Meldung und Wertung
        </SheetLabel>
        <Rule className="mt-2" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field error={formErrors.pointsWin ?? null} htmlFor="points-win" label="Punkte Sieg">
            <TextInput id="points-win" inputMode="numeric" {...register("pointsWin")} />
          </Field>
          <Field htmlFor="points-draw" label="Punkte Unentschieden">
            <TextInput id="points-draw" inputMode="numeric" {...register("pointsDraw")} />
          </Field>
          <Field htmlFor="points-loss" label="Punkte Niederlage">
            <TextInput id="points-loss" inputMode="numeric" {...register("pointsLoss")} />
          </Field>
          <Field
            error={formErrors.pointsDeciderBonus ?? null}
            hint={
              withDecider
                ? "Zusatzpunkt für den Sieger des Entscheidungsdoppels."
                : "Ohne Entscheidungsdoppel gibt es keinen Zusatzpunkt."
            }
            htmlFor="points-decider-bonus"
            label="Zusatzpunkt"
          >
            <TextInput
              disabled={!withDecider}
              id="points-decider-bonus"
              inputMode="numeric"
              {...register("pointsDeciderBonus")}
            />
          </Field>
          <Field
            error={formErrors.minNominations ?? null}
            htmlFor="min-nominations"
            label="Mindestmeldung"
          >
            <TextInput id="min-nominations" inputMode="numeric" {...register("minNominations")} />
          </Field>
          <Field
            error={formErrors.minNominationsShorthanded ?? null}
            hint="Reglement 2.2.5: Ausnahme mit weniger Personen."
            htmlFor="min-nominations-shorthanded"
            label="Ausnahmemeldung"
          >
            <TextInput
              id="min-nominations-shorthanded"
              inputMode="numeric"
              {...register("minNominationsShorthanded")}
            />
          </Field>
          <Field htmlFor="max-substitutions" label="Auswechslungen je Begegnung">
            <TextInput
              id="max-substitutions"
              inputMode="numeric"
              {...register("maxSubstitutionsPerEncounter")}
            />
          </Field>
          <Field
            hint="Im Entscheidungsdoppel gilt die Grenze nicht."
            htmlFor="max-doubles"
            label="Reguläre Doppel je Person"
          >
            <TextInput id="max-doubles" inputMode="numeric" {...register("maxDoublesPerPlayer")} />
          </Field>
        </div>
      </section>

      <section aria-labelledby="template-heading">
        <SheetLabel as="h2" id="template-heading">
          Begegnungsvorlage
        </SheetLabel>
        <Rule className="mt-2" />
        {formErrors.slots ? (
          <p className="mt-3 font-plate text-body text-ring-red-deep" role="alert">
            {formErrors.slots}
          </p>
        ) : null}
        {deciderWarning === null ? null : (
          <p className="mt-3 font-plate text-body text-sisal-500" role="status">
            {deciderWarning}
          </p>
        )}
        <div className="mt-4">
          <TemplateTable slots={slots} />
        </div>
      </section>

      {errorSummary.length === 0 ? null : (
        <Wedge className="p-4" tone="alarm">
          <SheetLabel as="h2" tone="alarm">
            Wettbewerb nicht angelegt
          </SheetLabel>
          <ul className="mt-1.5 flex flex-col gap-1">
            {errorSummary.map((entry) => (
              <li className="font-plate text-body text-wedge-900" key={entry.field}>
                <button
                  className="text-left underline underline-offset-4"
                  onClick={() => focusFirstError([entry.field])}
                  type="button"
                >
                  {entry.message}
                </button>
              </li>
            ))}
          </ul>
        </Wedge>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Control disabled={createCompetition.isPending} type="submit" variant="go">
          {createCompetition.isPending ? "Legt an …" : "Wettbewerb anlegen"}
        </Control>
        <p className="font-plate text-body text-sisal-500">
          Die Vorlage wird beim Ansetzen einer Begegnung kopiert. Spätere Änderungen betreffen
          bestehende Begegnungen nicht.
        </p>
      </div>
    </form>
  );
}


function Notice({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mt-6 border border-sisal-400 bg-sisal-100 px-6 py-10 text-center font-plate text-body text-wedge-900">
      {children}
    </div>
  );
}
