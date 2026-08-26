import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../lib/cn";
import { MarkCheck } from "./marks";

const plateVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center rounded-full font-numerals font-bold tabular leading-none select-none",
  {
    variants: {
      state: {
        /* Occupied: the black ring plate a number is stencilled onto. */
        playing: "bg-wedge-900 text-chalk ring-1 ring-spider/70",
        /* Free: the green of the double ring, filled. */
        free: "bg-ring-green text-chalk ring-1 ring-ring-green-deep",
        /* Blocked: taped off. The rim carries the alarm, the hatch repeats it. */
        blocked: "bg-wedge-900 text-sisal-300 ring-2 ring-ring-red",
        /* Neutral index plate, e.g. a step in the setup sheet. */
        quiet: "bg-sisal-100 text-sisal-500 ring-1 ring-sisal-400",
      },
      size: {
        sm: "size-7 text-[0.9375rem]",
        md: "size-11 text-[1.375rem]",
        lg: "size-14 text-[1.75rem]",
      },
    },
    defaultVariants: { state: "playing", size: "md" },
  },
);

export type BoardPlateProps = Omit<ComponentProps<"span">, "children"> &
  VariantProps<typeof plateVariants> & {
    readonly value: number | string;
  };

/**
 * A plate off the number ring, used as the venue's board index.
 * Decorative for assistive tech: the board's name is always rendered as text
 * beside it, so the numeral never carries information on its own.
 */
export function BoardPlate({ className, size, state, value, ...props }: BoardPlateProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(plateVariants({ size, state }), className)}
      {...props}
    >
      {value}
      {state === "blocked" ? (
        <span
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            backgroundImage:
              "repeating-linear-gradient(58deg, color-mix(in oklab, #b4232a 55%, transparent) 0 1.5px, transparent 1.5px 5px)",
          }}
        />
      ) : null}
    </span>
  );
}

export interface RingStep {
  readonly label: string;
  readonly state: "done" | "current" | "upcoming";
}

export interface RingStepsProps extends Omit<ComponentProps<"ol">, "children"> {
  readonly steps: readonly RingStep[];
}

/**
 * The setup sheet's progress: ring plates strung on the spider wire.
 * The sequence itself is the information, so the numbers stay.
 */
export function RingSteps({ className, steps, ...props }: RingStepsProps) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)} {...props}>
      {steps.map((step, index) => (
        <li className="flex items-center gap-3" key={step.label}>
          {index > 0 ? <span aria-hidden="true" className="h-px w-6 bg-sisal-400" /> : null}
          <span className="flex items-center gap-2">
            {step.state === "done" ? (
              <span
                aria-hidden="true"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-ring-green text-chalk ring-1 ring-ring-green-deep"
              >
                <MarkCheck size={13} />
              </span>
            ) : (
              <BoardPlate
                size="sm"
                state={step.state === "current" ? "playing" : "quiet"}
                value={index + 1}
              />
            )}
            <span
              className={cn(
                "font-plate text-[0.6875rem] font-semibold uppercase tracking-[0.14em]",
                step.state === "current" ? "text-wedge-900" : "text-sisal-500",
              )}
            >
              {step.label}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
