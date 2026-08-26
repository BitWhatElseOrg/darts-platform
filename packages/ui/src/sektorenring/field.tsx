import type { ComponentProps, ReactNode } from "react";

import { cn } from "../lib/cn";
import { MarkChevron, MarkCross } from "./marks";
import { SheetLabel } from "./typography";

const inputBase = [
  "min-h-11 w-full rounded-lg border bg-sisal-50 px-3 font-plate text-[0.9375rem] text-wedge-900",
  "placeholder:text-sisal-500",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green",
  "disabled:cursor-not-allowed disabled:bg-sisal-100 disabled:text-sisal-500",
].join(" ");

export interface FieldProps {
  readonly label: string;
  readonly htmlFor: string;
  readonly hint?: string;
  /** Names the problem and the way out, never just "invalid". */
  readonly error?: string | null;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A ruled entry on the setup sheet: caption, value, and the note under it.
 * Hint and error carry stable ids (`<id>-hint`, `<id>-error`) so the control
 * inside can point at them with aria-describedby.
 */
export function Field({ children, className, error, hint, htmlFor, label }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <SheetLabel as="label" htmlFor={htmlFor}>
        {label}
      </SheetLabel>
      {children}
      {error ? (
        <p
          className="flex items-start gap-1.5 font-plate text-[0.75rem] text-ring-red-deep"
          id={`${htmlFor}-error`}
        >
          <MarkCross className="mt-px shrink-0" size={12} />
          {error}
        </p>
      ) : hint ? (
        <p className="font-plate text-[0.75rem] text-sisal-500" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export type TextInputProps = ComponentProps<"input">;

export function TextInput({ className, type = "text", ...props }: TextInputProps) {
  return (
    <input
      className={cn(inputBase, "border-sisal-400 focus:border-ring-green", className)}
      type={type}
      {...props}
    />
  );
}

export type SelectInputProps = ComponentProps<"select">;

export function SelectInput({ children, className, ...props }: SelectInputProps) {
  return (
    <span className="relative block">
      <select
        className={cn(
          inputBase,
          "appearance-none border-sisal-400 pr-9 focus:border-ring-green",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <MarkChevron
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sisal-500"
        size={14}
      />
    </span>
  );
}
