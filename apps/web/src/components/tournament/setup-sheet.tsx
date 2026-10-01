"use client";

import {
  BoardPlate,
  Control,
  Field,
  MarkFlight,
  RingSteps,
  Rule,
  type RingStep,
  SelectInput,
  SheetLabel,
  StateTag,
  TextInput,
  Wedge,
} from "@darts-platform/ui";
import {
  clubDuelPreviewSchema,
  createClassicTournamentSchema,
  createClubDuelTournamentSchema,
  tournamentStructurePreviewSchema,
  tournamentSummarySchema,
  type BoardResponse,
  type CreateTournamentInput,
  type PlayerResponse,
} from "@darts-platform/schemas";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { NavLink, PageNav } from "@/components/page-nav";
import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { bestOfOptions, describeMatchFormat } from "@/lib/match-format";
import {
  ClubDuelPreviewCard,
  ClubModeSection,
  ClubParticipantsSection,
  ClubSidesSection,
} from "./club-duel-setup";
import { buildClubDuelCandidate } from "./club-duel-setup-values";
import type { SetupFormValues } from "./setup-form-values";

export type { SetupFormValues } from "./setup-form-values";

/** Id des Formulars; der Start-Button haengt per `form`-Attribut daran. */
const SETUP_FORM_ID = "tournament-setup-form";

/** Field-level German copy for the contract's validation failures. */
const MESSAGES: Record<string, string> = {
  name: "Das Turnier braucht einen Namen, unter dem es in der Liste auffindbar ist.",
  startsAt: "Wähle ein Startdatum.",
  participantIds: "Ein Turnier braucht mindestens vier Teilnehmer.",
  groupCount: "Jede Gruppe braucht mindestens zwei Teilnehmer. Reduziere die Gruppenzahl.",
  qualifyPerGroup: "Mindestens zwei Teilnehmer müssen sich qualifizieren.",
  knockoutSize: "Das K.-o.-Tableau muss alle Qualifizierten aufnehmen können.",
  boardIds: "Wähle mindestens ein Board, auf dem gespielt wird.",
  bestOfLegs: "Best of Legs muss eine ungerade Zahl sein.",
  bestOfSets: "Best of Sets muss eine ungerade Zahl sein.",
  inRule: "Wähle, wie ein Leg eröffnet wird.",
  outRule: "Wähle, wie ein Leg geschlossen wird.",
  sideAName: "Trage den Namen des eigenen Vereins ein.",
  sideBName: "Trage den Namen des Gastvereins ein.",
  qualifyingRounds: "Die Qualifikation braucht 1 bis 15 Runden.",
  finalRoundSize: "Jeder Verein braucht mindestens so viele Spieler, wie die Finalrunde Plätze hat.",
  participants: "Jeder Verein braucht mindestens so viele Spieler, wie die Finalrunde Plätze hat.",
};

/** Auswahlfelder ohne fokussierbares Eingabeelement: der Sprung geht zur Meldung. */
const SELECTION_KEYS = new Set(["participantIds", "participants", "boardIds"]);

export function SetupSheet({ organizationId, organizationName, players, boards }: {
  readonly organizationId: string;
  /** Belegt im Vereinsduell «Eigener Verein» vor. */
  readonly organizationName?: string;
  /** Mitglieder und Gäste; das klassische Turnier nimmt nur Mitglieder. */
  readonly players: readonly PlayerResponse[];
  readonly boards: readonly BoardResponse[];
}) {
  const router = useRouter();
  const [contractErrors, setContractErrors] = useState<Record<string, string>>({});
  const members = players.filter((player) => player.kind === "MEMBER");
  const guests = players.filter((player) => player.kind === "GUEST");
  const defaultParticipantCount = Math.min(members.length, 32);
  const defaultGroupCount = defaultParticipantCount >= 16 ? 8 : defaultParticipantCount >= 8 ? 4 : 2;
  const defaultKnockoutSize = defaultGroupCount * 2;

  const { control, formState, getValues, handleSubmit, register, setFocus, setValue } = useForm<SetupFormValues>({
    defaultValues: {
      name: "",
      startsAt: "2026-09-12",
      format: "GROUPS_THEN_KNOCKOUT",
      startingScore: "501",
      inRule: "STRAIGHT",
      outRule: "DOUBLE",
      mode: "MATCHPLAY",
      bestOfLegs: "3",
      bestOfSets: "3",
      participantIds: members.slice(0, 32).map((player) => player.id),
      groupCount: String(defaultGroupCount),
      qualifyPerGroup: "2",
      knockoutSize: String(defaultKnockoutSize),
      seeding: "SEEDED",
      boardIds: boards.map((board) => board.id),
      sideAName: organizationName ?? "",
      sideBName: "",
      qualifyingRounds: "4",
      finalRoundSize: "4",
      thirdPlaceMatch: true,
      sideAIds: [],
      sideBIds: [],
    },
  });

  const values = useWatch({ control });
  const participantCount = values.participantIds?.length ?? 0;
  const boardCount = values.boardIds?.length ?? 0;
  const clubDuel = values.format === "CLUB_DUEL";
  const sideAIds = values.sideAIds ?? [];
  const sideBIds = values.sideBIds ?? [];
  const finalRoundSize = Number(values.finalRoundSize) || 2;

  // Meldungen gehören zum Format, das sie erzeugt hat: nach einem Wechsel
  // stünden sonst klassische Fehler über dem Vereinsduell (und umgekehrt).
  // Zurückgesetzt wird während des Renderns statt in einem Effekt
  // (react-hooks/set-state-in-effect; «Adjusting state when a prop changes»).
  const [errorsFormat, setErrorsFormat] = useState(values.format);
  if (errorsFormat !== values.format) {
    setErrorsFormat(values.format);
    setContractErrors({});
  }

  const previewQuery = useQuery({
    queryKey: [
      "tournament-preview",
      organizationId,
      values.format,
      participantCount,
      values.groupCount,
      values.qualifyPerGroup,
      values.knockoutSize,
    ],
    queryFn: ({ signal }) => apiRequest({
      path: `/organizations/${organizationId}/tournaments/structure-preview`,
      method: "POST",
      body: {
        format: values.format,
        participantCount,
        groupCount: Math.max(Number(values.groupCount) || 1, 1),
        qualifyPerGroup: Math.max(Number(values.qualifyPerGroup) || 1, 1),
        knockoutSize: Number(values.knockoutSize) || 2,
      },
      schema: tournamentStructurePreviewSchema,
      signal,
    }),
    enabled: !clubDuel && participantCount >= 2,
  });
  const preview = previewQuery.data ?? {
    groups: [], groupMatchCount: 0, knockoutSize: 0, knockoutMatchCount: 0,
    byes: 0, totalMatches: 0, warnings: participantCount < 2 ? ["Mindestens zwei Teilnehmer auswählen."] : [],
  };

  const clubPreviewQuery = useQuery({
    queryKey: [
      "club-duel-preview",
      organizationId,
      sideAIds.length,
      sideBIds.length,
      values.qualifyingRounds,
      finalRoundSize,
      values.thirdPlaceMatch,
      boardCount,
      values.bestOfLegs,
    ],
    queryFn: ({ signal }) => apiRequest({
      path: `/organizations/${organizationId}/tournaments/club-duel-preview`,
      method: "POST",
      body: {
        sideACount: sideAIds.length,
        sideBCount: sideBIds.length,
        qualifyingRounds: Number(values.qualifyingRounds) || 1,
        finalRoundSize,
        thirdPlaceMatch: values.thirdPlaceMatch ?? true,
        boardCount: Math.max(boardCount, 1),
        bestOfLegs: Number(values.bestOfLegs) || 1,
      },
      schema: clubDuelPreviewSchema,
      signal,
    }),
    enabled: clubDuel && Math.min(sideAIds.length, sideBIds.length) >= finalRoundSize,
  });
  const clubPreview = clubPreviewQuery.data ?? null;

  const createMutation = useMutation({
    mutationFn: (data: CreateTournamentInput) => apiRequest({
      path: `/organizations/${organizationId}/tournaments`,
      method: "POST",
      body: data,
      schema: tournamentSummarySchema,
    }),
    onSuccess: (tournament) => {
      router.push(`/turniere/${tournament.id}?organisation=${organizationId}`);
    },
  });

  const basicsStep: RingStep = { label: "Turnier", state: (values.name?.trim().length ?? 0) > 0 ? "done" : "current" };
  const boardsStep: RingStep = { label: "Boards", state: boardCount > 0 ? "done" : "upcoming" };
  const steps: readonly RingStep[] = clubDuel
    ? [
      basicsStep,
      {
        label: "Vereine",
        state: (values.sideAName?.trim() ?? "") !== "" && (values.sideBName?.trim() ?? "") !== "" ? "done" : "upcoming",
      },
      { label: "Spieler", state: Math.min(sideAIds.length, sideBIds.length) >= finalRoundSize ? "done" : "upcoming" },
      { label: "Modus", state: clubPreview !== null && clubPreview.warnings.length === 0 ? "done" : "current" },
      boardsStep,
    ]
    : [
      basicsStep,
      { label: "Teilnehmer", state: participantCount >= 4 ? "done" : "upcoming" },
      { label: "Struktur", state: preview.warnings.length === 0 ? "done" : "current" },
      boardsStep,
    ];

  function onSubmit(formValues: SetupFormValues) {
    const parsed = formValues.format === "CLUB_DUEL"
      ? createClubDuelTournamentSchema.safeParse(buildClubDuelCandidate(formValues))
      : createClassicTournamentSchema.safeParse(classicCandidate(formValues));
    if (!parsed.success) {
      const next: Record<string, string> = {};
      parsed.error.issues.forEach((issue) => {
        const key = String(issue.path[0] ?? "form");
        next[key] = MESSAGES[key] ?? issue.message;
      });
      setContractErrors(next);
      revealInvalidField(String(parsed.error.issues[0]?.path[0] ?? "form"));
      return;
    }
    setContractErrors({});
    createMutation.mutate(parsed.data);
  }

  function classicCandidate(formValues: SetupFormValues) {
    return {
      name: formValues.name,
      startsAt: new Date(`${formValues.startsAt}T18:00:00.000Z`),
      format: formValues.format,
      startingScore: Number(formValues.startingScore),
      inRule: formValues.inRule,
      outRule: formValues.outRule,
      maxRounds: null,
      bestOfLegs: Number(formValues.bestOfLegs),
      bestOfSets: formValues.mode === "MATCHPLAY" ? 1 : Number(formValues.bestOfSets),
      participantIds: [...formValues.participantIds],
      groupCount: Number(formValues.groupCount),
      qualifyPerGroup: Number(formValues.qualifyPerGroup),
      knockoutSize: Number(formValues.knockoutSize),
      seeding: formValues.seeding,
      boardIds: [...formValues.boardIds],
    };
  }

  /**
   * Der Button steht am Ende einer langen Seite, das erste Feld am Anfang.
   * Ohne diesen Sprung blieb ein Klick ohne Namen fuer die Nutzerin ohne
   * sichtbare Wirkung: die Meldung stand oben, ausserhalb des Sichtfelds.
   * Registrierte Felder bekommen den Fokus (der Browser scrollt sie ins
   * Bild); die Auswahlfelder ohne Eingabeelement scrollen zu ihrer Meldung,
   * die erst mit dem naechsten Render erscheint.
   */
  function revealInvalidField(key: string) {
    if (key in MESSAGES && !SELECTION_KEYS.has(key)) {
      setFocus(key as keyof SetupFormValues);
      return;
    }
    if (typeof window === "undefined") return;
    window.setTimeout(() => {
      const target = document.getElementById(`${key}-error`);
      if (target !== null && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 0);
  }

  function nextSelection(selected: readonly string[] | undefined, id: string): string[] {
    const current = new Set(selected ?? []);
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    return [...current];
  }

  const toggleParticipant = (id: string) =>
    setValue("participantIds", nextSelection(values.participantIds, id), { shouldDirty: true });

  /** Eine Person steht auf hoechstens einer Seite: die andere verliert sie. */
  // `getValues` statt der gerenderten Werte: `addGuestsToSideB` laeuft erst
  // nach der Antwort des Servers, die Auswahl kann sich inzwischen geaendert haben.
  const toggleSide = (side: "A" | "B", id: string) => {
    const [own, other] = side === "A" ? (["sideAIds", "sideBIds"] as const) : (["sideBIds", "sideAIds"] as const);
    setValue(other, getValues(other).filter((entry) => entry !== id), { shouldDirty: true });
    setValue(own, nextSelection(getValues(own), id), { shouldDirty: true });
  };

  /** «Alle»/«Keinen» in Spalte A; wer dazukommt, verlässt Seite B. */
  const selectSideA = (ids: readonly string[]) => {
    setValue("sideBIds", getValues("sideBIds").filter((entry) => !ids.includes(entry)), { shouldDirty: true });
    setValue("sideAIds", [...ids], { shouldDirty: true });
  };

  const addGuestsToSideB = (created: readonly PlayerResponse[]) => {
    const createdIds = created.map((player) => player.id);
    setValue("sideAIds", getValues("sideAIds").filter((entry) => !createdIds.includes(entry)), { shouldDirty: true });
    setValue("sideBIds", [...new Set([...getValues("sideBIds"), ...createdIds])], { shouldDirty: true });
  };

  const toggleBoard = (id: string) =>
    setValue("boardIds", nextSelection(values.boardIds, id), { shouldDirty: true });

  return (
    <main className="sektorenring min-h-screen">
      {/*
        Das Formular selbst bleibt leer: im Vereinsduell steht das
        Gastspieler-Panel mit eigenem <form> mitten in der Seite, und
        verschachtelte Formulare sind kein gueltiges HTML. Der Start-Button
        haengt per `form`-Attribut am Formular, die Felder fuehrt React Hook Form.
      */}
      <form id={SETUP_FORM_ID} noValidate onSubmit={(event) => void handleSubmit(onSubmit)(event)} />
      <div className="mx-auto max-w-[1500px] px-5 py-8 xl:px-9">
        <PageNav>
          <NavLink href={`/turniere?organisation=${organizationId}`}>Alle Turniere</NavLink>
        </PageNav>

        <h1 className="font-numerals text-headline font-bold text-wedge-900">
          Turnier anlegen
        </h1>
        <p className="mt-1.5 max-w-[65ch] prose-de font-plate text-body text-sisal-500">
          Vier Angaben, dann erzeugt die Turnier-Engine Gruppen, Setzung und Spielplan. Mit dem
          Start wird die Struktur verbindlich eröffnet; alle Befehle werden auditiert.
        </p>
        <div className="mt-5">
          <RingSteps steps={steps} />
        </div>

        <div className="mt-7 grid items-start gap-x-9 gap-y-8 xl:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="flex flex-col gap-8">
            <section aria-labelledby="setup-basics">
              <SheetLabel as="h2" id="setup-basics">
                1 · Turnier
              </SheetLabel>
              <Rule className="mt-2" />
              <div className="mt-4 flex flex-col gap-6">
                <div>
                  <SheetLabel as="p" className="text-caption normal-case">Grunddaten</SheetLabel>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    <Field
                      className="sm:col-span-2"
                      error={contractErrors.name ?? null}
                      htmlFor="name"
                      label="Name"
                    >
                      <TextInput
                        aria-describedby={contractErrors.name ? "name-error" : undefined}
                        id="name"
                        placeholder="Vereinsmeisterschaft 2026"
                        {...register("name")}
                      />
                    </Field>
                    <Field
                      error={contractErrors.startsAt ?? null}
                      htmlFor="startsAt"
                      label="Startdatum"
                    >
                      <TextInput
                        aria-describedby={contractErrors.startsAt ? "startsAt-error" : undefined}
                        id="startsAt"
                        type="date"
                        {...register("startsAt")}
                      />
                    </Field>
                    <Field htmlFor="format" label="Format">
                      <SelectInput id="format" {...register("format")}>
                        <option value="GROUPS_THEN_KNOCKOUT">Gruppen, dann K.-o.</option>
                        <option value="ROUND_ROBIN">Jeder gegen jeden</option>
                        <option value="SINGLE_ELIMINATION">Einfach-K.-o.</option>
                        <option value="CLUB_DUEL">Vereinsduell</option>
                      </SelectInput>
                    </Field>
                    <Field htmlFor="startingScore" label="Startscore">
                      <SelectInput id="startingScore" {...register("startingScore")}>
                        <option value="301">301</option>
                        <option value="501">501</option>
                        <option value="701">701</option>
                      </SelectInput>
                    </Field>
                  </div>
                </div>
                <div>
                  <SheetLabel as="p" className="text-caption normal-case">Spielregeln</SheetLabel>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    <Field htmlFor="mode" label="Spielmodus">
                      <SelectInput id="mode" {...register("mode")}>
                        <option value="MATCHPLAY">Matchplay</option>
                        <option value="SETS">Sets</option>
                      </SelectInput>
                    </Field>
                    <Field
                      error={contractErrors.bestOfLegs ?? null}
                      htmlFor="bestOfLegs"
                      label={values.mode === "SETS" ? "Best of Legs je Satz" : "Best of Legs"}
                    >
                      <SelectInput
                        aria-describedby={contractErrors.bestOfLegs ? "bestOfLegs-error" : undefined}
                        id="bestOfLegs"
                        {...register("bestOfLegs")}
                      >
                        {bestOfOptions.map((count) => <option key={count} value={String(count)}>Best of {count}</option>)}
                      </SelectInput>
                    </Field>
                    {values.mode === "SETS" ? (
                      <Field
                        error={contractErrors.bestOfSets ?? null}
                        htmlFor="bestOfSets"
                        label="Best of Sätze"
                      >
                        <SelectInput
                          aria-describedby={contractErrors.bestOfSets ? "bestOfSets-error" : undefined}
                          id="bestOfSets"
                          {...register("bestOfSets")}
                        >
                          {bestOfOptions.map((count) => <option key={count} value={String(count)}>Best of {count}</option>)}
                        </SelectInput>
                      </Field>
                    ) : null}
                    <p className="font-plate text-caption text-sisal-500 sm:col-span-2">
                      {describeMatchFormat({
                        bestOfLegs: Number(values.bestOfLegs ?? "3"),
                        bestOfSets: values.mode === "SETS" ? Number(values.bestOfSets ?? "3") : 1,
                      })}
                    </p>
                    <Field error={contractErrors.inRule ?? null} htmlFor="inRule" label="In-Regel">
                      <SelectInput
                        aria-describedby={contractErrors.inRule ? "inRule-error" : undefined}
                        id="inRule"
                        {...register("inRule")}
                      >
                        <option value="STRAIGHT">Straight In</option>
                        <option value="DOUBLE">Double In</option>
                      </SelectInput>
                    </Field>
                    <Field error={contractErrors.outRule ?? null} htmlFor="outRule" label="Out-Regel">
                      <SelectInput
                        aria-describedby={contractErrors.outRule ? "outRule-error" : undefined}
                        id="outRule"
                        {...register("outRule")}
                      >
                        <option value="SINGLE">Single Out</option>
                        <option value="DOUBLE">Double Out</option>
                        <option value="MASTER">Master Out</option>
                      </SelectInput>
                    </Field>
                  </div>
                </div>
              </div>
            </section>

            {clubDuel ? (
              <>
                <ClubSidesSection errors={contractErrors} register={register} />
                <ClubParticipantsSection
                  error={contractErrors.participants ?? null}
                  guests={guests}
                  members={members}
                  onGuestsCreated={addGuestsToSideB}
                  onSelectAllA={selectSideA}
                  onToggle={toggleSide}
                  organizationId={organizationId}
                  sideAIds={sideAIds}
                  sideAName={values.sideAName ?? ""}
                  sideBIds={sideBIds}
                  sideBName={values.sideBName ?? ""}
                />
                <ClubModeSection
                  errors={contractErrors}
                  finalRoundMax={Math.min(sideAIds.length, sideBIds.length)}
                  register={register}
                />
              </>
            ) : (
              <>
                <section aria-labelledby="setup-participants">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <SheetLabel as="h2" id="setup-participants">
                      2 · Teilnehmer
                    </SheetLabel>
                    <div className="flex items-center gap-3">
                      <span className="font-numerals text-counter font-bold tabular text-wedge-900">
                        {participantCount}
                      </span>
                      <Control
                        density="tight"
                        onClick={() =>
                          setValue(
                            "participantIds",
                            participantCount === members.length
                              ? []
                              : members.map((player) => player.id),
                            { shouldDirty: true },
                          )
                        }
                        variant="wire"
                      >
                        {participantCount === members.length ? "Keinen" : "Alle"}
                      </Control>
                    </div>
                  </div>
                  <Rule className="mt-2" />
                  {contractErrors.participantIds ? (
                    <p
                      className="mt-2 font-plate text-caption text-ring-red-deep"
                      id="participantIds-error"
                      role="alert"
                    >
                      {contractErrors.participantIds}
                    </p>
                  ) : null}
                  <ul className="mt-3 grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
                    {members.map((player) => {
                      const checked = (values.participantIds ?? []).includes(player.id);
                      return (
                        <li className="border-b border-sisal-300" key={player.id}>
                          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 py-1.5 font-plate text-body text-wedge-900">
                            <input
                              aria-describedby={
                                contractErrors.participantIds ? "participantIds-error" : undefined
                              }
                              checked={checked}
                              className="size-4 shrink-0 accent-ring-green"
                              onChange={() => toggleParticipant(player.id)}
                              type="checkbox"
                            />
                            <span className="truncate" title={player.displayName}>{player.displayName}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>

                <section aria-labelledby="setup-structure">
                  <SheetLabel as="h2" id="setup-structure">
                    3 · Struktur
                  </SheetLabel>
                  <Rule className="mt-2" />
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <Field
                      error={contractErrors.groupCount ?? null}
                      htmlFor="groupCount"
                      label="Gruppen"
                    >
                      <SelectInput
                        aria-describedby={contractErrors.groupCount ? "groupCount-error" : undefined}
                        disabled={values.format !== "GROUPS_THEN_KNOCKOUT"}
                        id="groupCount"
                        {...register("groupCount")}
                      >
                        {[2, 4, 6, 8, 10, 12, 16].map((count) => (
                          <option key={count} value={count}>
                            {count}
                          </option>
                        ))}
                      </SelectInput>
                    </Field>
                    <Field
                      error={contractErrors.qualifyPerGroup ?? null}
                      htmlFor="qualifyPerGroup"
                      label="Qualifikanten je Gruppe"
                    >
                      <SelectInput
                        aria-describedby={
                          contractErrors.qualifyPerGroup ? "qualifyPerGroup-error" : undefined
                        }
                        disabled={values.format !== "GROUPS_THEN_KNOCKOUT"}
                        id="qualifyPerGroup"
                        {...register("qualifyPerGroup")}
                      >
                        {[1, 2, 3, 4].map((count) => (
                          <option key={count} value={count}>
                            {count}
                          </option>
                        ))}
                      </SelectInput>
                    </Field>
                    <Field
                      error={contractErrors.knockoutSize ?? null}
                      htmlFor="knockoutSize"
                      label="K.-o.-Tableau"
                    >
                      <SelectInput
                        aria-describedby={
                          contractErrors.knockoutSize ? "knockoutSize-error" : undefined
                        }
                        disabled={values.format === "ROUND_ROBIN"}
                        id="knockoutSize"
                        {...register("knockoutSize")}
                      >
                        {[2, 4, 8, 16, 32, 64].map((size) => (
                          <option key={size} value={size}>
                            {size}er
                          </option>
                        ))}
                      </SelectInput>
                    </Field>
                    <Field htmlFor="seeding" label="Setzung">
                      <SelectInput disabled={values.format === "ROUND_ROBIN"} id="seeding" {...register("seeding")}>
                        <option value="SEEDED">Nach Setzliste</option>
                        <option value="RANDOM">Zufällig</option>
                      </SelectInput>
                    </Field>
                  </div>
                </section>
              </>
            )}

            <section aria-labelledby="setup-boards">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <SheetLabel as="h2" id="setup-boards">
                  {clubDuel ? "5" : "4"} · Boards
                </SheetLabel>
                <span className="font-numerals text-counter font-bold tabular text-wedge-900">
                  {boardCount}
                </span>
              </div>
              <Rule className="mt-2" />
              {contractErrors.boardIds ? (
                <p
                  className="mt-2 font-plate text-caption text-ring-red-deep"
                  id="boardIds-error"
                  role="alert"
                >
                  {contractErrors.boardIds}
                </p>
              ) : null}
              <ul className="mt-4 flex flex-wrap gap-3">
                {boards.map((board, index) => {
                  const checked = (values.boardIds ?? []).includes(board.id);
                  return (
                    <li key={board.id}>
                      <label
                        className={
                          checked
                            ? "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border-2 border-ring-green bg-sisal-100 px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring-green"
                            : "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-sisal-400 px-3 hover:bg-sisal-100 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring-green"
                        }
                      >
                        <input
                          aria-describedby={contractErrors.boardIds ? "boardIds-error" : undefined}
                          checked={checked}
                          className="sr-only"
                          onChange={() => toggleBoard(board.id)}
                          type="checkbox"
                        />
                        <BoardPlate
                          size="sm"
                          state={checked ? "free" : "quiet"}
                          value={index + 1}
                        />
                        <span className="font-plate text-body font-medium text-wedge-900">
                          {board.name}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

          <div className="flex flex-col gap-4 xl:sticky xl:top-6">
            {clubDuel ? (
              <ClubDuelPreviewCard
                error={clubPreviewQuery.error ? userFacingErrorMessage(clubPreviewQuery.error) : null}
                loading={clubPreviewQuery.isFetching}
                preview={clubPreview}
                sideAName={values.sideAName ?? ""}
                sideBName={values.sideBName ?? ""}
              />
            ) : (
              <Wedge className="p-5" tone="plate">
                <SheetLabel as="h2">Vorschau der Turnier-Engine</SheetLabel>
                <Rule className="mt-2" tone="faint" />
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                  {[
                    ["Gruppen", preview.groups.length],
                    ["Gruppenmatches", preview.groupMatchCount],
                    ["K.-o.-Matches", preview.knockoutMatchCount],
                    ["Freilose", preview.byes],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <dt className="font-plate text-label font-semibold uppercase tracking-[0.14em] text-sisal-500">
                        {label}
                      </dt>
                      <dd className="font-numerals text-title font-bold tabular text-wedge-900">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <Rule className="mt-4" tone="faint" />
                <p className="mt-3 flex items-baseline justify-between gap-3">
                  <span className="font-plate text-body font-semibold text-wedge-900">
                    Matches insgesamt
                  </span>
                  <span className="font-numerals text-data font-bold tabular text-wedge-900">
                    {preview.totalMatches}
                  </span>
                </p>
                <p className="mt-2 font-plate text-caption text-sisal-500">
                  {preview.groups.map((group) => `${group.label}: ${group.participantCount}`).join(" · ")}
                </p>
                {preview.warnings.length > 0 ? (
                  <ul className="mt-4 flex flex-col gap-2">
                    {preview.warnings.map((warning) => (
                      <li className="flex flex-col gap-1" key={warning}>
                        <StateTag label="prüfen" tone="blocked" />
                        <span className="font-plate text-caption text-wedge-900">
                          {warning}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4">
                    <StateTag label="Struktur geht auf" tone="free" />
                  </p>
                )}
              </Wedge>
            )}

            <Control
              disabled={formState.isSubmitting || createMutation.isPending}
              form={SETUP_FORM_ID}
              icon={<MarkFlight size={13} />}
              type="submit"
              variant="go"
            >
              Turnier starten
            </Control>
            <p className="font-plate text-caption text-sisal-500">
              Der Start erzeugt den persistenten Spielplan. Eine nachträgliche Strukturänderung
              ist im aktuellen MVP bewusst nicht verfügbar.
            </p>
            {Object.keys(contractErrors).length > 0 ? (
              <Wedge className="p-4" data-testid="submit-errors" role="alert" tone="alarm">
                <SheetLabel as="h2" tone="alarm">Eingaben prüfen</SheetLabel>
                <ul className="mt-1.5 flex flex-col gap-1 font-plate text-body text-wedge-900">
                  {Object.values(contractErrors).map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </Wedge>
            ) : null}

            {!clubDuel && previewQuery.error ? (
              <Wedge className="p-4" tone="plate">
                <SheetLabel as="h3">Vorschau nicht verfügbar</SheetLabel>
                <p className="mt-1.5 font-plate text-caption text-sisal-500">{userFacingErrorMessage(previewQuery.error)}</p>
              </Wedge>
            ) : null}
            {createMutation.error ? (
              <Wedge className="p-4" tone="alarm">
                <SheetLabel as="h3" tone="alarm">Turnier konnte nicht angelegt werden</SheetLabel>
                <p className="mt-1.5 font-plate text-caption text-wedge-900">{userFacingErrorMessage(createMutation.error)}</p>
              </Wedge>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
