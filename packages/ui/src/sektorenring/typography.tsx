import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ElementType } from "react";

import { cn } from "../lib/cn";

const scoreVariants = cva("font-numerals font-bold tabular", {
  variants: {
    size: {
      /* The remaining score of the player at the oche: the largest thing on the page. */
      display: "text-[3.5rem] leading-[0.78] tracking-[-0.02em]",
      lead: "text-[2rem] leading-[0.85] tracking-[-0.015em]",
      quiet: "text-[1.25rem] leading-none tracking-[-0.01em]",
    },
    tone: {
      chalk: "text-chalk",
      ink: "text-wedge-900",
      dim: "text-spider-dim",
      finish: "text-ring-green-lit",
    },
  },
  defaultVariants: { size: "lead", tone: "ink" },
});

export type ScoreProps = ComponentProps<"span"> & VariantProps<typeof scoreVariants>;

/** Enamel numerals off the number ring. Always tabular: columns of scores must align. */
export function Score({ className, size, tone, ...props }: ScoreProps) {
  return <span className={cn(scoreVariants({ size, tone }), className)} {...props} />;
}

const sheetLabelVariants = cva(
  "font-plate text-[0.625rem] font-semibold uppercase tracking-[0.16em]",
  {
    variants: {
      tone: {
        ink: "text-sisal-500",
        chalk: "text-spider",
        alarm: "text-ring-red-deep",
      },
    },
    defaultVariants: { tone: "ink" },
  },
);

export type SheetLabelProps = ComponentProps<"p"> &
  VariantProps<typeof sheetLabelVariants> & {
    readonly as?: ElementType;
    /** Set together with `as="label"` when the caption labels a control. */
    readonly htmlFor?: string;
  };

/**
 * The ruled caption of a printed plate. It labels a data group and is the
 * group's heading in its own right — never a kicker stacked above another one.
 */
export function SheetLabel({ as, className, tone, ...props }: SheetLabelProps) {
  const Tag = (as ?? "p") as ElementType;
  return <Tag className={cn(sheetLabelVariants({ tone }), className)} {...props} />;
}
