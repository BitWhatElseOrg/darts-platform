import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

/**
 * The printed checkout table is this world's model for numbers in rows:
 * hairlines instead of fills, tabular figures, no zebra, no card around it.
 */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <table
      className={cn("w-full border-collapse font-plate text-[0.875rem] tabular", className)}
      {...props}
    />
  );
}

export function Th({ className, scope = "col", ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-sisal-400 pb-1.5 text-left font-semibold text-[0.625rem] uppercase tracking-[0.14em] text-sisal-500",
        className,
      )}
      scope={scope}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return (
    <td className={cn("border-b border-sisal-300 py-1.5 align-middle", className)} {...props} />
  );
}

export type TrProps = ComponentProps<"tr"> & {
  /** A qualifying place. Marked by ground and a mark in the row, not by hue alone. */
  readonly qualified?: boolean;
};

export function Tr({ className, qualified = false, ...props }: TrProps) {
  return (
    <tr
      className={cn(qualified && "bg-sisal-100", className)}
      data-qualified={qualified ? "true" : undefined}
      {...props}
    />
  );
}
