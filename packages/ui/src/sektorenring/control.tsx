import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../lib/cn";

const controlVariants = cva(
  [
    "inline-flex min-h-11 items-center justify-center gap-2 px-5",
    "font-plate text-[0.875rem] font-semibold uppercase tracking-[0.1em]",
    "transition-colors duration-150",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green",
    "disabled:pointer-events-none disabled:opacity-45",
  ],
  {
    variants: {
      variant: {
        /* The action that starts a match: the double ring, filled. */
        go: "bg-ring-green text-chalk hover:bg-ring-green-deep",
        /* A painted black plate: the ordinary committing action. */
        plate: "bg-wedge-900 text-chalk hover:bg-wedge-800",
        /* Wire outline: secondary, reversible actions. */
        wire: "border border-sisal-400 bg-transparent text-wedge-900 hover:bg-sisal-100",
        /* Wire outline on a black field. */
        wireInk:
          "border border-spider/50 bg-transparent text-chalk hover:bg-wedge-800 focus-visible:outline-ring-green-lit",
        /* Destructive or blocking: the red ring. */
        danger: "bg-ring-red text-chalk hover:bg-ring-red-deep",
      },
      density: {
        default: "min-h-11",
        tight: "min-h-9 px-3 text-[0.75rem] tracking-[0.12em]",
      },
    },
    defaultVariants: { variant: "plate", density: "default" },
  },
);

export type ControlProps = ComponentProps<"button"> &
  VariantProps<typeof controlVariants> & {
    /** The keystroke that does the same thing, shown so it gets learned. */
    readonly shortcut?: string;
    readonly icon?: ReactNode;
  };

export function Control({
  children,
  className,
  density,
  icon,
  shortcut,
  type = "button",
  variant,
  ...props
}: ControlProps) {
  return (
    <button
      className={cn(controlVariants({ density, variant }), className)}
      type={type}
      {...props}
    >
      {icon}
      {children}
      {shortcut ? (
        <kbd
          className={cn(
            "ml-1 grid min-w-5 place-items-center border px-1 py-px font-numerals text-[0.75rem] font-bold tabular",
            variant === "wire"
              ? "border-sisal-400 text-sisal-500"
              : "border-chalk/40 text-chalk/85",
          )}
        >
          {shortcut}
        </kbd>
      ) : null}
    </button>
  );
}
