import type { ComponentProps, ReactNode } from "react";

import { cn } from "../lib/cn";
import { MarkBar, MarkClock, MarkCross, MarkDisc, MarkDoubleRing, MarkHatch } from "./marks";

export type StateTone = "free" | "live" | "finish" | "blocked" | "conflict" | "waiting";

/** Every tone pairs a colour with a drawn mark and a word. All three, always. */
const marks: Record<StateTone, (props: { readonly size?: number }) => ReactNode> = {
  free: MarkDisc,
  live: MarkBar,
  finish: MarkDoubleRing,
  blocked: MarkHatch,
  conflict: MarkCross,
  waiting: MarkClock,
};

const onInk: Record<StateTone, string> = {
  free: "text-ring-green-lit",
  live: "text-spider",
  finish: "text-ring-green-lit",
  blocked: "text-ring-red-lit",
  conflict: "text-ring-red-lit",
  waiting: "text-spider",
};

const onSisal: Record<StateTone, string> = {
  free: "text-ring-green-deep",
  live: "text-sisal-500",
  finish: "text-ring-green-deep",
  blocked: "text-ring-red-deep",
  conflict: "text-ring-red-deep",
  waiting: "text-sisal-500",
};

export interface StateTagProps extends Omit<ComponentProps<"span">, "children"> {
  readonly tone: StateTone;
  readonly label: string;
  /** Which ground the tag sits on, so the pairing stays above 4.5:1. */
  readonly on?: "ink" | "sisal";
}

export function StateTag({ className, label, on = "sisal", tone, ...props }: StateTagProps) {
  const MarkGlyph = marks[tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-plate text-caption font-semibold uppercase tracking-[0.12em]",
        on === "ink" ? onInk[tone] : onSisal[tone],
        className,
      )}
      {...props}
    >
      <MarkGlyph size={12} />
      {label}
    </span>
  );
}
