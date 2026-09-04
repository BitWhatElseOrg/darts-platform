import type { ComponentProps, FormEventHandler, ReactNode } from "react";

import { cn } from "../lib/cn";
import { MarkChevron, MarkCross } from "./marks";
import { SheetLabel } from "./typography";

const inputBase = [
  "min-h-11 w-full rounded-lg border bg-sisal-50 px-3 font-plate text-field text-wedge-900",
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
    // `data-field` ist der Griff, an dem `FieldRow` das Feld in seine drei
    // Zeilen einhängt. Ohne `FieldRow` bleibt das Attribut wirkungslos.
    <div className={cn("flex flex-col gap-1.5", className)} data-field="">
      <SheetLabel as="label" htmlFor={htmlFor}>
        {label}
      </SheetLabel>
      {children}
      {error ? (
        <p
          className="flex items-start gap-1.5 font-plate text-caption text-ring-red-deep prose-de"
          id={`${htmlFor}-error`}
        >
          <MarkCross className="mt-px shrink-0" size={12} />
          {error}
        </p>
      ) : hint ? (
        <p className="font-plate text-caption text-sisal-500 prose-de" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Die drei Zeilen einer Formularzeile — Beschriftung, Eingabe, Notiz — als
 * Raster des Elternteils. `grid-rows-subgrid` hängt jedes Feld in genau diese
 * Zeilen ein; alles andere in der Zeile (der Absendeknopf) steht auf der
 * Eingabezeile.
 *
 * Die letzte Spalte ist dabei Absicht, nicht Bequemlichkeit: ein Kind mit
 * fester Zeile wird vor allen automatisch platzierten einsortiert und
 * belegte sonst Spalte 1, noch bevor das erste Feld an der Reihe ist. Der
 * Knopf schliesst die Zeile ab - das ist der Vertrag dieser Komponente.
 */
const alignedRows = {
  sm: [
    "sm:grid-rows-[auto_auto_auto] sm:gap-y-1.5",
    "sm:[&>[data-field]]:row-span-3 sm:[&>[data-field]]:grid sm:[&>[data-field]]:grid-rows-subgrid",
    "sm:[&>:not([data-field])]:col-start-[-2] sm:[&>:not([data-field])]:row-start-2",
  ].join(" "),
  lg: [
    "lg:grid-rows-[auto_auto_auto] lg:gap-y-1.5",
    "lg:[&>[data-field]]:row-span-3 lg:[&>[data-field]]:grid lg:[&>[data-field]]:grid-rows-subgrid",
    "lg:[&>:not([data-field])]:col-start-[-2] lg:[&>:not([data-field])]:row-start-2",
  ].join(" "),
} as const;

export interface FieldRowProps {
  /** Häufig ist die Zeile das Formular selbst. */
  readonly as?: "div" | "form";
  readonly children: ReactNode;
  readonly className?: string;
  /** Ab welcher Breite die Felder nebeneinander stehen. Darunter stapeln sie. */
  readonly from?: keyof typeof alignedRows;
  readonly onSubmit?: FormEventHandler<HTMLFormElement>;
}

/**
 * Eine Formularzeile, in der Feld an Feld steht.
 *
 * Ein Raster mit `items-end` richtet die Kästen aus, nicht die Eingaben: ein
 * Feld mit Hinweis oder Fehlermeldung ist höher, also rutscht seine Eingabe
 * gegenüber der Nachbarin nach oben. Auf «Team anlegen» stand der Kurzname
 * deshalb dauerhaft eine Zeile über dem Namen, und in der Begegnungsansicht
 * springt die ganze Zeile, sobald eine Validierung zuschlägt.
 *
 * `FieldRow` gibt allen Feldern dieselben drei Zeilen. Beschriftungen und
 * Eingaben stehen damit auf einer Linie, unabhängig davon, welches Feld
 * gerade eine Notiz unter sich trägt.
 */
export function FieldRow({ as = "div", children, className, from = "sm", onSubmit }: FieldRowProps) {
  const rowClassName = cn("grid gap-4", alignedRows[from], className);
  if (as === "form") {
    return (
      <form className={rowClassName} onSubmit={onSubmit}>
        {children}
      </form>
    );
  }
  return <div className={rowClassName}>{children}</div>;
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
