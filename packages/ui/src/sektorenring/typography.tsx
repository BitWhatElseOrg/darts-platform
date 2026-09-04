import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ElementType } from "react";

import { cn } from "../lib/cn";

const scoreVariants = cva("font-numerals font-bold tabular", {
  variants: {
    size: {
      /* The remaining score of the player at the oche: the largest thing on the page. */
      display: "text-display",
      lead: "text-data",
      quiet: "text-title-sm",
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

const nameVariants = cva("font-plate text-field font-semibold", {
  variants: {
    tone: {
      ink: "text-wedge-900",
      chalk: "text-chalk",
      dim: "text-spider/85",
      quiet: "text-sisal-500",
    },
  },
  defaultVariants: { tone: "ink" },
});

export type NameProps = ComponentProps<"span"> & VariantProps<typeof nameVariants>;

/**
 * A person, pair or team, wherever one is named. The field step is the one
 * place a name may not shrink, so active and inactive differ by tone — never
 * by size.
 */
export function Name({ className, tone, ...props }: NameProps) {
  return <span className={cn(nameVariants({ tone }), className)} {...props} />;
}

const sheetLabelVariants = cva(
  "min-w-0 font-plate text-label font-semibold uppercase",
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
