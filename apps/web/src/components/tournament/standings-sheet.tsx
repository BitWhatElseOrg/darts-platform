import {
  MarkCheck,
  MarkDoubleRing,
  Rule,
  SheetLabel,
  Table,
  Td,
  Th,
  Tr,
} from "@darts-platform/ui";
import type { GroupStanding } from "@darts-platform/schemas";

interface StandingsSheetProps {
  readonly groups: readonly GroupStanding[];
}

/**
 * The printed group sheet: typeset, not carded. Qualifying places are marked by
 * ground, by the double-ring mark and by the column header — never by hue alone.
 */
export function StandingsSheet({ groups }: StandingsSheetProps) {
  return (
    <section aria-labelledby="standings-heading">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <SheetLabel as="h2" id="standings-heading">
          Gruppenstand · zwei qualifizieren
        </SheetLabel>
        <span className="font-plate text-[0.75rem] text-sisal-500">
          {groups.length} Gruppen
        </span>
      </div>
      <Rule />
      <div className="grid gap-x-8 gap-y-6 pt-4 sm:grid-cols-2 xl:grid-cols-4">
        {groups.map((group) => {
          const complete = group.playedMatches >= group.totalMatches;
          return (
            <article key={group.groupLabel}>
              <div className="flex items-baseline justify-between gap-2 pb-1">
                <h3 className="font-numerals text-[1.125rem] font-bold tracking-[-0.01em] text-wedge-900">
                  Gruppe {group.groupLabel}
                </h3>
                <span className="flex items-center gap-1.5 font-numerals text-[0.75rem] font-bold tabular text-sisal-500">
                  {complete ? <MarkCheck className="text-ring-green" size={11} /> : null}
                  {group.playedMatches}/{group.totalMatches}
                </span>
              </div>
              <Table>
                <caption className="sr-only">
                  Tabelle der Gruppe {group.groupLabel}. Die ersten zwei Plätze qualifizieren sich.
                </caption>
                <thead>
                  <tr>
                    <Th className="w-6">Pl</Th>
                    <Th>Spieler</Th>
                    <Th className="w-7 text-right">S</Th>
                    <Th className="w-10 text-right">Legs</Th>
                    <Th className="w-8 text-right">Diff</Th>
                    <Th className="w-7 text-right">Pkt</Th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <Tr key={row.playerId} qualified={row.qualified}>
                      <Td className="pl-0.5">
                        <span className="flex items-center gap-1">
                          {row.qualified ? (
                            <MarkDoubleRing className="text-ring-green" size={10} />
                          ) : null}
                          <span className="font-numerals font-bold">{row.position}</span>
                        </span>
                      </Td>
                      <Td className="max-w-0 truncate pr-2 font-medium">
                        {row.displayName}
                        {row.qualified ? <span className="sr-only"> (qualifiziert)</span> : null}
                      </Td>
                      <Td className="text-right">{row.won}</Td>
                      <Td className="text-right text-sisal-500">
                        {row.legsFor}:{row.legsAgainst}
                      </Td>
                      <Td className="text-right">
                        {row.legDifference > 0 ? `+${row.legDifference}` : row.legDifference}
                      </Td>
                      <Td className="pr-0.5 text-right font-numerals font-bold">{row.points}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </article>
          );
        })}
      </div>
    </section>
  );
}
