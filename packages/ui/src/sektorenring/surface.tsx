import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ElementType } from "react";

import { cn } from "../lib/cn";

const wedgeVariants = cva("relative rounded-2xl", {
  variants: {
    tone: {
      /* A black sector: the field a running match is painted on. */
      ink: "bg-wedge-900 text-chalk border border-wedge-700",
      /* An open sector: sisal showing through, rimmed in double-ring green. */
      free: "bg-sisal-100 text-wedge-900 border-2 border-ring-green",
      /* A taped-off sector. */
      blocked: "bg-wedge-900 text-spider border-2 border-ring-red",
      /* A mounted plate on the sisal ground. */
      plate: "bg-sisal-100 text-wedge-900 border border-sisal-400",
      /* A plate carrying an unresolved conflict. */
      alarm: "bg-sisal-50 text-wedge-900 border-2 border-ring-red",
    },
    lift: {
      /* Mounted on the wall: a real offset and a real blur. */
      true: "shadow-2xl shadow-black/20",
      false: "",
    },
  },
  defaultVariants: { tone: "plate", lift: true },
});

export type WedgeProps = ComponentProps<"div"> &
  VariantProps<typeof wedgeVariants> & { readonly as?: ElementType };

/**
 * A tournament panel using the same rounded surface language as the entry page.
 */
export function Wedge({ as, className, lift, tone, ...props }: WedgeProps) {
  const Tag = (as ?? "div") as ElementType;
  return <Tag className={cn(wedgeVariants({ lift, tone }), className)} {...props} />;
}

export interface RuleProps extends Omit<ComponentProps<"span">, "children"> {
  readonly orientation?: "horizontal" | "vertical";
  readonly tone?: "steel" | "ink" | "faint";
}

/** The spider wire. Every divider in this world is one of these. */
export function Rule({
  className,
  orientation = "horizontal",
  tone = "ink",
  ...props
}: RuleProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block shrink-0",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        tone === "steel" ? "bg-spider/45" : tone === "faint" ? "bg-sisal-300" : "bg-sisal-400",
        className,
      )}
      {...props}
    />
  );
}
