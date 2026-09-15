"use client";

import { inputClassName, labelClassName } from "./players/form-styles";

export interface FilterSelect {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
}

/**
 * Suchfeld, Filterauswahl und Trefferzahl fuer die langen Listen. Die
 * Trefferzahl steht in einer `aria-live`-Region, damit auch ohne Blick auf die
 * Liste hoerbar wird, dass ein Filter greift (AGENTS.md §19).
 */
export function ListFilterBar({
  searchId,
  searchLabel,
  searchPlaceholder,
  search,
  onSearchChange,
  selects,
  resultLabel,
  onReset,
  isFiltered,
}: {
  readonly searchId: string;
  readonly searchLabel: string;
  readonly searchPlaceholder: string;
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly selects: readonly FilterSelect[];
  readonly resultLabel: string;
  readonly onReset: () => void;
  readonly isFiltered: boolean;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <label className={labelClassName} htmlFor={searchId}>{searchLabel}</label>
          <input
            id={searchId}
            className={inputClassName}
            type="search"
            placeholder={searchPlaceholder}
            onChange={(event) => onSearchChange(event.target.value)}
            value={search}
          />
        </div>
        {selects.map((select) => (
          <div className="space-y-2" key={select.id}>
            <label className={labelClassName} htmlFor={select.id}>{select.label}</label>
            <select
              id={select.id}
              className={inputClassName}
              onChange={(event) => select.onChange(event.target.value)}
              value={select.value}
            >
              {select.options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-caption text-slate-400">{resultLabel}</p>
        {isFiltered ? (
          <button
            className="min-h-11 rounded-lg border border-slate-700 px-4 text-body font-medium text-slate-100"
            onClick={onReset}
            type="button"
          >
            Filter zurücksetzen
          </button>
        ) : null}
      </div>
    </div>
  );
}
