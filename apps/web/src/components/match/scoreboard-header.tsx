"use client";

import Link from "next/link";
import type { MatchStateResponse } from "@darts-platform/schemas";
import { variantLabel } from "@/lib/league-format";
import { currentRoundNumber, liveHref } from "@/lib/scoreboard-view";

const iconButtonClassName =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-chalk transition hover:bg-sisal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green";

/** Zurück-Pfeil: rein dekorativ, die zugängliche Bezeichnung trägt der Link. */
function BackArrowIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path d="M15 18 9 12l6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Zahnrad: rein dekorativ, die zugängliche Bezeichnung trägt der Knopf. */
function GearIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Fragezeichen: rein dekorativ, die zugängliche Bezeichnung trägt der Link. */
function HelpIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.33c-.77.3-1.4.98-1.4 1.92v.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="17.5" fill="currentColor" r="0.75" stroke="none" />
    </svg>
  );
}

/**
 * Kopfzeile der Vollbildfläche: links der Rückweg samt Leg und laufender
 * Runde, in der Mitte Startscore und Spielart, rechts der Weg zur
 * öffentlichen Live-Ansicht (nur mit Wettbewerbsbezug) und die
 * Einstellungen.
 */
export function ScoreboardHeader({ backHref, backLabel, match, onOpenSettings }: {
  readonly backHref: string;
  readonly backLabel: string;
  readonly match: MatchStateResponse;
  readonly onOpenSettings: () => void;
}) {
  const round = currentRoundNumber({ currentLegNumber: match.currentLegNumber, visits: match.visits });
  const live = liveHref({ boardId: match.boardId, liveTarget: match.liveTarget });
  return (
    <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-sisal-300 bg-sisal-200 px-3 py-2 sm:px-4">
      <div>
        <Link aria-label={backLabel} className={iconButtonClassName} href={backHref}>
          <BackArrowIcon />
        </Link>
        {/* Leg und Runde sind die einzigen veraenderlichen Werte dieser Zeile
            und standen auf 10 px, waehrend der konstante Startscore auf
            1,5 rem sitzt. Die Ziffer traegt jetzt den `counter`-Schritt
            (1 rem, tabular) -- aus Armlaenge im Stehen lesbar --, das Wort
            bleibt die ruhige Beschriftung. */}
        <p className="mt-1 flex items-baseline gap-1 text-label text-spider-dim">
          LEG <span className="font-numerals text-counter font-bold tabular text-spider">{match.currentLegNumber}</span>
        </p>
        <p className="flex items-baseline gap-1 text-label text-spider-dim">
          RUNDE <span className="font-numerals text-counter font-bold tabular text-chalk">{round}</span>
        </p>
      </div>
      <div className="text-center">
        <p className="font-numerals text-title font-bold text-chalk">{match.startingScore}</p>
        <p className="text-caption text-spider-dim">
          {variantLabel({ startingScore: match.startingScore, inRule: match.inRule, outRule: match.outRule })}
        </p>
      </div>
      <div className="flex items-center justify-end gap-1">
        {live !== null ? (
          <Link
            className="inline-flex min-h-11 items-center rounded-lg px-2 text-label font-semibold text-ring-green transition hover:bg-sisal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green"
            href={live}
          >
            LIVE
          </Link>
        ) : null}
        <Link aria-label="Bedienungsanleitung" className={iconButtonClassName} href="/bedienungsanleitung.html">
          <HelpIcon />
        </Link>
        <button aria-label="Einstellungen" className={iconButtonClassName} onClick={onOpenSettings} type="button">
          <GearIcon />
        </button>
      </div>
    </header>
  );
}
