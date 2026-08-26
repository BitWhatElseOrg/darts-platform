"use client";

import { useMutation } from "@tanstack/react-query";
import { advancedFormatPreviewSchema, type AdvancedFormatPreviewInput } from "@darts-platform/schemas";
import { Control, Field, Rule, SelectInput, SheetLabel, TextInput, Wedge } from "@darts-platform/ui";
import Link from "next/link";
import { useState } from "react";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { useTournamentOrganization } from "./use-tournament-organization";

type StageType = AdvancedFormatPreviewInput["stages"][number]["type"];
interface WorkshopStage { readonly id: string; readonly type: StageType; readonly rounds: number; readonly advance: number }

const stageLabels: Readonly<Record<StageType, string>> = {
  ROUND_ROBIN: "Jeder gegen jeden",
  SINGLE_ELIMINATION: "Einfach-K.-o.",
  DOUBLE_ELIMINATION: "Doppel-K.-o.",
  SWISS: "Schweizer System",
  PLACEMENT: "Platzierungsspiel",
};

export function FormatWorkshop({ requestedOrganizationId }: { readonly requestedOrganizationId: string | undefined }) {
  const { query, organization } = useTournamentOrganization(requestedOrganizationId);
  const [participantCount, setParticipantCount] = useState(32);
  const [competitorKind, setCompetitorKind] = useState<"PLAYER" | "PAIR" | "TEAM">("PLAYER");
  const [bestOfLegs, setBestOfLegs] = useState(3);
  const [bestOfSets, setBestOfSets] = useState(1);
  const [stages, setStages] = useState<readonly WorkshopStage[]>([
    { id: crypto.randomUUID(), type: "SWISS", rounds: 5, advance: 16 },
    { id: crypto.randomUUID(), type: "DOUBLE_ELIMINATION", rounds: 1, advance: 1 },
  ]);
  const preview = useMutation({
    mutationFn: () => apiRequest({
      path: `/organizations/${organization?.id ?? ""}/tournaments/advanced-format-preview`,
      method: "POST",
      body: { participantCount, competitorKind, bestOfLegs, bestOfSets, stages: stages.map((stage, index) => ({ key: `stage-${index + 1}`, type: stage.type, rounds: stage.rounds, advance: stage.advance })) },
      schema: advancedFormatPreviewSchema,
    }),
  });
  if (query.isPending) return <Notice text="Organisation wird geladen …" />;
  if (organization === null) return <Notice text="Keine zugängliche Organisation gefunden." />;

  const updateStage = (id: string, patch: Partial<WorkshopStage>) => setStages((current) => current.map((stage) => stage.id === id ? { ...stage, ...patch } : stage));
  return <main className="sektorenring min-h-screen">
    <div className="mx-auto max-w-5xl px-5 py-8">
      <Link className="font-plate text-sm text-sisal-500 underline" href={`/turniere?organisation=${organization.id}`}>Alle Turniere</Link>
      <h1 className="mt-5 font-numerals text-5xl font-bold text-wedge-900">Formatwerkstatt</h1>
      <p className="mt-2 max-w-2xl font-plate text-sm leading-relaxed text-sisal-500">Konfiguriere mehrstufige Turnierformate, Teams oder Paare und den Set-Modus. Die Engine prüft Qualifikation, Byes und Matchanzahl serverseitig.</p>
      <Rule className="mt-6" />
      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field htmlFor="teilnehmerzahl" label="Teilnehmer"><TextInput id="teilnehmerzahl" min={2} max={256} onChange={(event) => setParticipantCount(Number(event.target.value))} type="number" value={participantCount} /></Field>
        <Field htmlFor="teilnehmerart" label="Teilnehmerart"><SelectInput id="teilnehmerart" onChange={(event) => setCompetitorKind(event.target.value as typeof competitorKind)} value={competitorKind}><option value="PLAYER">Einzel</option><option value="PAIR">Paare</option><option value="TEAM">Teams</option></SelectInput></Field>
        <Field htmlFor="legs" label="Best of Legs"><SelectInput id="legs" onChange={(event) => setBestOfLegs(Number(event.target.value))} value={bestOfLegs}><option value={1}>Best of 1</option><option value={3}>Best of 3</option><option value={5}>Best of 5</option><option value={7}>Best of 7</option></SelectInput></Field>
        <Field htmlFor="sets" label="Best of Sets"><SelectInput id="sets" onChange={(event) => setBestOfSets(Number(event.target.value))} value={bestOfSets}><option value={1}>Best of 1</option><option value={3}>Best of 3</option><option value={5}>Best of 5</option></SelectInput></Field>
      </section>

      <section className="mt-9">
        <div className="flex items-center justify-between"><SheetLabel as="h2">Turnierphasen in Reihenfolge</SheetLabel><Control onClick={() => setStages((current) => [...current, { id: crypto.randomUUID(), type: "SINGLE_ELIMINATION", rounds: 1, advance: 1 }])} variant="wire">Turnierphase hinzufügen</Control></div>
        <Rule className="mt-2" />
        <ol className="mt-4 space-y-3">{stages.map((stage, index) => <li className="grid gap-3 border border-sisal-400 bg-sisal-100 p-4 sm:grid-cols-[3rem_1fr_9rem_9rem_auto]" key={stage.id}>
          <strong className="font-numerals text-2xl">{index + 1}</strong>
          <SelectInput aria-label={`Format von Stage ${index + 1}`} onChange={(event) => updateStage(stage.id, { type: event.target.value as StageType })} value={stage.type}>{Object.entries(stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectInput>
          <TextInput aria-label={`Runden von Stage ${index + 1}`} disabled={stage.type !== "SWISS"} min={1} max={15} onChange={(event) => updateStage(stage.id, { rounds: Number(event.target.value) })} type="number" value={stage.rounds} />
          <TextInput aria-label={`Qualifizierte aus Stage ${index + 1}`} disabled={stage.type === "PLACEMENT"} min={1} max={participantCount} onChange={(event) => updateStage(stage.id, { advance: Number(event.target.value) })} type="number" value={stage.advance} />
          <Control disabled={stages.length === 1} onClick={() => setStages((current) => current.filter((candidate) => candidate.id !== stage.id))} variant="wire">Entfernen</Control>
        </li>)}</ol>
      </section>

      <Control className="mt-6" disabled={preview.isPending} onClick={() => preview.mutate()} variant="primary">Format prüfen</Control>
      {preview.error ? <Wedge className="mt-5 p-4" tone="alarm"><p className="font-plate text-sm">{userFacingErrorMessage(preview.error)}</p></Wedge> : null}
      {preview.data ? <section className="mt-7 border border-sisal-400 bg-sisal-50 p-5">
        <SheetLabel as="h2">Geprüfter Ablauf · {preview.data.totalMatches} Matches</SheetLabel>
        <ol className="mt-4 space-y-2">{preview.data.stages.map((stage) => <li className="grid grid-cols-[1fr_auto] border-b border-sisal-300 py-3 font-plate text-sm" key={stage.key}><span>{stageLabels[stage.type]} · {stage.entrantCount} starten, {stage.advancingCount} kommen weiter</span><strong>{stage.matchCount} Matches</strong></li>)}</ol>
        {preview.data.warnings.map((warning) => <p className="mt-3 font-plate text-sm text-ring-red-deep" key={warning}>{warning}</p>)}
      </section> : null}
    </div>
  </main>;
}

function Notice({ text }: { readonly text: string }) { return <main className="sektorenring min-h-screen p-10 font-plate">{text}</main>; }
