"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createdDisplayKeySchema,
  displayKeyListSchema,
  type CreatedDisplayKey,
  type DisplayKey,
  type DisplayKeyList,
} from "@darts-platform/schemas";
import { Control, Field, SheetLabel, StateTag, TextInput, Wedge, type StateTone } from "@darts-platform/ui";
import { useState } from "react";
import { z } from "zod";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";

interface DisplayKeysPanelProps {
  readonly organizationId: string;
  readonly tournamentId: string;
  /**
   * `tournament:share` -- eine EIGENE Berechtigung, nicht das gleichnamig
   * wirkende `canShare` aus `share-panel.tsx` (das prueft `tournament:update`,
   * ein reiner Namenszufall, siehe `tournament-dashboard-route.tsx`). Die
   * eigentliche Schranke liegt serverseitig in `DisplayKeysService` -- dieses
   * Flag blendet nur eine Oberflaeche aus, die ohne die Berechtigung ohnehin
   * an jeder Anfrage mit 403 scheitern wuerde.
   */
  readonly canManageDisplayKeys: boolean;
}

function stateAppearance(state: DisplayKey["state"]): { readonly label: string; readonly tone: StateTone } {
  switch (state) {
    case "valid":
      return { label: "gültig", tone: "free" };
    case "expired":
      return { label: "abgelaufen", tone: "waiting" };
    case "revoked":
      return { label: "widerrufen", tone: "blocked" };
  }
}

function formatExpiry(value: Date): string {
  return new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

/**
 * Verwaltung der Anzeige-Schluessel eines Turniers (Task 6): ausstellen,
 * auflisten, widerrufen. Der Klartext eines frisch ausgestellten Schluessels
 * existiert serverseitig nur in genau der Antwort, die ihn erzeugt hat
 * (`createdDisplayKeySchema`) -- er steht deshalb hier ausschliesslich in
 * `freshKey` und verschwindet mit `setFreshKey(null)` wieder vollstaendig aus
 * dem Zustand dieser Komponente, statt nur ausgeblendet zu werden.
 */
export function DisplayKeysPanel({ canManageDisplayKeys, organizationId, tournamentId }: DisplayKeysPanelProps) {
  const queryClient = useQueryClient();
  const queryKey = ["display-keys", organizationId, tournamentId] as const;
  const [label, setLabel] = useState("");
  const [copied, setCopied] = useState(false);
  const [freshKey, setFreshKey] = useState<CreatedDisplayKey | null>(null);

  const keysQuery = useQuery({
    queryKey,
    queryFn: () =>
      apiRequest({
        path: `/organizations/${organizationId}/tournaments/${tournamentId}/display-keys`,
        schema: displayKeyListSchema,
      }),
    enabled: canManageDisplayKeys,
  });

  const issue = useMutation({
    mutationFn: () =>
      apiRequest({
        path: `/organizations/${organizationId}/tournaments/${tournamentId}/display-keys`,
        method: "POST",
        body: { label: label.trim() },
        schema: createdDisplayKeySchema,
      }),
    onSuccess: (created) => {
      setFreshKey(created);
      setCopied(false);
      setLabel("");
      queryClient.setQueryData(queryKey, (current: DisplayKeyList | undefined): DisplayKeyList => {
        const { expiresAt, id, label: keyLabel, revokedAt, state } = created;
        return { keys: [...(current?.keys ?? []), { expiresAt, id, label: keyLabel, revokedAt, state }] };
      });
    },
  });

  const revoke = useMutation({
    mutationFn: (keyId: string) =>
      apiRequest({
        path: `/organizations/${organizationId}/tournaments/${tournamentId}/display-keys/${keyId}`,
        method: "DELETE",
        schema: z.void(),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  });

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  // Serverseitig scheitert jede dieser Anfragen ohne `tournament:share`
  // ohnehin (Task 4/5) -- das Panel taeuscht darum erst gar keine Bedienung
  // vor, wenn es an dieser Berechtigung fehlt.
  if (!canManageDisplayKeys) return null;

  const keys = keysQuery.data?.keys ?? [];

  return (
    <Wedge aria-labelledby="display-keys-heading" as="section" className="mt-5 flex flex-col gap-4 p-4" tone="plate">
      <div>
        <SheetLabel as="h2" id="display-keys-heading">Anzeige-Schlüssel</SheetLabel>
        <p className="mt-1.5 font-plate text-body text-wedge-900">
          Ein Anzeige-Schlüssel öffnet die Board- oder TV-Ansicht eines privaten Turniers, ohne es öffentlich freizugeben.
        </p>
      </div>

      {freshKey !== null ? (
        <div className="flex flex-col gap-2 border-2 border-ring-green bg-sisal-50 p-3" role="alert">
          <p className="font-plate text-body font-semibold text-wedge-900">{freshKey.label}</p>
          <p className="break-all font-numerals text-field font-bold tabular text-wedge-900">{freshKey.secret}</p>
          <p className="font-plate text-caption text-sisal-500">Dieser Schlüssel wird nicht wieder angezeigt.</p>
          <div className="flex flex-wrap gap-2">
            <Control density="tight" onClick={() => void copySecret(freshKey.secret)} type="button" variant="wire">
              {copied ? "Kopiert" : "Kopieren"}
            </Control>
            <Control density="tight" onClick={() => setFreshKey(null)} type="button" variant="wire">
              Schliessen
            </Control>
          </div>
        </div>
      ) : null}

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (label.trim().length === 0) return;
          issue.mutate();
        }}
      >
        <Field htmlFor="display-key-label" label="Bezeichnung">
          <TextInput
            id="display-key-label"
            maxLength={80}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="z. B. Eingang Halle"
            value={label}
          />
        </Field>
        <Control disabled={issue.isPending || label.trim().length === 0} type="submit" variant="plate">
          Schlüssel ausstellen
        </Control>
      </form>
      {issue.isError ? (
        <p className="font-plate text-body text-ring-red-deep">
          {userFacingErrorMessage(issue.error, "Schlüssel konnte nicht ausgestellt werden.")}
        </p>
      ) : null}
      {revoke.isError ? (
        <p className="font-plate text-body text-ring-red-deep">
          {userFacingErrorMessage(revoke.error, "Schlüssel konnte nicht widerrufen werden.")}
        </p>
      ) : null}

      {keysQuery.isPending ? (
        <p className="font-plate text-body text-sisal-500">Schlüssel werden geladen …</p>
      ) : keys.length === 0 ? (
        <p className="font-plate text-body text-sisal-500">Noch kein Schlüssel ausgestellt.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {keys.map((key) => {
            const appearance = stateAppearance(key.state);
            return (
              <li
                className="flex flex-wrap items-center justify-between gap-3 border-b border-sisal-300 py-2 last:border-b-0"
                key={key.id}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-plate text-body font-semibold text-wedge-900">{key.label}</p>
                  <p className="font-plate text-caption text-sisal-500">Gültig bis {formatExpiry(key.expiresAt)}</p>
                </div>
                <StateTag label={appearance.label} tone={appearance.tone} />
                {key.state === "valid" ? (
                  <Control
                    density="tight"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(key.id)}
                    type="button"
                    variant="wire"
                  >
                    Widerrufen
                  </Control>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Wedge>
  );
}
