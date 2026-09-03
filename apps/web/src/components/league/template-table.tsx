import { Table, Td, Th, Tr } from "@darts-platform/ui";

import { disciplineLabel, variantLabel } from "@/lib/league-format";

/**
 * Die Begegnungsvorlage als Spielrapport. Dieselbe Tabelle trägt den Entwurf
 * im Formular und die eingefrorene Vorlage eines bestehenden Wettbewerbs;
 * beide Quellen haben dieselben Felder.
 */
export interface TemplateRow {
  readonly sequence: number;
  readonly role: "REGULAR" | "DECIDER";
  readonly discipline: "SINGLES" | "DOUBLES";
  readonly label: string;
  readonly homePosition: number | null;
  readonly awayPosition: number | null;
  readonly startingScore: number;
  readonly inRule: "STRAIGHT" | "DOUBLE";
  readonly outRule: "SINGLE" | "DOUBLE" | "MASTER";
  readonly bestOfLegs: number;
}

export function TemplateTable({ slots }: { readonly slots: readonly TemplateRow[] }) {
  const singles = slots.filter((slot) => slot.discipline === "SINGLES").length;
  const doubles = slots.length - singles;

  return (
    <div>
      <p className="font-plate text-[0.875rem] text-sisal-500">
        {slots.length} Spiele je Begegnung · {singles} Einzel · {doubles} Doppel
        {slots.some((slot) => slot.role === "DECIDER")
          ? ", davon ein Entscheidungsdoppel bei Gleichstand"
          : ""}
      </p>
      <div className="mt-3 overflow-x-auto">
        <Table>
          <caption className="sr-only">Begegnungsvorlage: alle Spiele in Reihenfolge</caption>
          <thead>
            <Tr>
              <Th className="w-12">Nr.</Th>
              <Th>Spiel</Th>
              <Th className="w-24">Art</Th>
              <Th className="w-40">Paarung</Th>
              <Th className="w-56">Variante</Th>
              <Th className="w-24">Distanz</Th>
            </Tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <Tr key={slot.sequence}>
                <Td className="font-numerals font-bold text-wedge-900">{slot.sequence}</Td>
                <Td className="text-wedge-900">
                  {slot.label}
                  {slot.role === "DECIDER" ? (
                    <span className="ml-2 font-plate text-[0.625rem] tracking-[0.12em] text-sisal-500 uppercase">
                      nur bei Gleichstand
                    </span>
                  ) : null}
                </Td>
                <Td className="text-sisal-500">{disciplineLabel(slot.discipline)}</Td>
                <Td className="text-sisal-500">
                  {slot.homePosition === null || slot.awayPosition === null
                    ? "am Spielabend gemeldet"
                    : `Heim ${slot.homePosition} gegen Gast ${slot.awayPosition}`}
                </Td>
                <Td className="text-sisal-500">
                  {variantLabel({
                    startingScore: slot.startingScore,
                    inRule: slot.inRule,
                    outRule: slot.outRule,
                  })}
                </Td>
                <Td className="text-sisal-500">Best of {slot.bestOfLegs}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
