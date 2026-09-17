"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { playerSchema } from "@darts-platform/schemas";
import { Button, buttonVariants, cn } from "@darts-platform/ui";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { prepareAvatarUpload } from "@/lib/avatar-upload";

import { PlayerAvatar, type AvatarPlayer } from "./player-avatar";

/**
 * Hochladen und Entfernen des Profilbilds.
 *
 * Die Sichtbarkeit dieses Bedienelements ist reine Bequemlichkeit — wer die
 * Berechtigung nicht hat, sieht es gar nicht erst. Die eigentliche Prüfung
 * bleibt serverseitig (`PlayersService.requireAvatarWrite`, AGENTS.md §13):
 * ein `PUT`/`DELETE` ohne Berechtigung scheitert dort unabhängig davon, ob
 * diese Fläche überhaupt gerendert wurde.
 *
 * Zwei Abfrageschlüssel zeigen dasselbe Bild an zwei Stellen — die
 * Spielerliste und der Profilkopf — und beide müssen nach einer Änderung
 * neu geladen werden, sonst zeigt eine der beiden Flächen das alte Bild
 * weiter (siehe `player-profile.tsx`).
 */
export function PlayerAvatarControl({
  organizationId,
  player,
}: {
  readonly organizationId: string;
  readonly player: AvatarPlayer;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ readonly url: string; readonly blob: Blob } | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const invalidateAvatarQueries = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["players", organizationId] }),
      queryClient.invalidateQueries({ queryKey: ["player-avatar", organizationId, player.id] }),
    ]);

  // Die Mutationsantwort IST bereits der frische Datensatz. `setQueryData`
  // schreibt ihn synchron in den `player-avatar`-Cache, BEVOR die Vorschau
  // verschwindet bzw. invalidiert wird — sonst rendert `PlayerAvatar`
  // zwischen dem Verwerfen der Vorschau und dem Abschluss von
  // `invalidateAvatarQueries` kurz mit dem alten (oder bei einer Neuanlage:
  // fehlenden) Bild wieder die Initialen, und bliebe dort stehen, wenn der
  // Nachlade-Request scheitert, obwohl der Upload selbst durchlief.
  const uploadAvatar = useMutation({
    mutationFn: (blob: Blob) =>
      apiRequest({
        path: `/organizations/${organizationId}/players/${player.id}/avatar`,
        method: "PUT",
        rawBody: blob,
        schema: playerSchema,
      }),
    onSuccess: async (data) => {
      queryClient.setQueryData(["player-avatar", organizationId, player.id], data);
      clearSelection();
      await invalidateAvatarQueries();
    },
  });

  const removeAvatar = useMutation({
    mutationFn: () =>
      apiRequest({
        path: `/organizations/${organizationId}/players/${player.id}/avatar`,
        method: "DELETE",
        schema: playerSchema,
      }),
    onSuccess: async (data) => {
      queryClient.setQueryData(["player-avatar", organizationId, player.id], data);
      await invalidateAvatarQueries();
    },
  });

  function clearSelection() {
    setPreview((current) => {
      if (current !== null) URL.revokeObjectURL(current.url);
      return null;
    });
    if (fileInputRef.current !== null) fileInputRef.current.value = "";
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    setSelectionError(null);
    uploadAvatar.reset();
    try {
      const blob = await prepareAvatarUpload(file);
      setPreview((current) => {
        if (current !== null) URL.revokeObjectURL(current.url);
        return { url: URL.createObjectURL(blob), blob };
      });
    } catch {
      // Konkrete Ursachen (kein 2D-Kontext, `createImageBitmap` scheitert an
      // einer Datei, die der Browser nicht dekodieren kann) sind fürs
      // Publikum nicht handlungsrelevant; die Server-Fehlermeldung für
      // dasselbe Problem lautet ohnehin gleich.
      setSelectionError("Diese Datei liess sich nicht als Bild lesen. Wähle ein JPEG, PNG oder WebP.");
      if (fileInputRef.current !== null) fileInputRef.current.value = "";
    }
  }

  const errorMessage =
    selectionError ??
    (uploadAvatar.isError ? userFacingErrorMessage(uploadAvatar.error) : null) ??
    (removeAvatar.isError ? userFacingErrorMessage(removeAvatar.error) : null);

  return (
    <div className="flex flex-col gap-3">
      {/* Auch hier `flex-wrap`: auf sehr schmalen Geraeten rutscht die
          Knopfspalte unter das Bild, statt neben ihm zusammengedrueckt zu
          werden. */}
      <div className="flex flex-wrap items-center gap-4">
        {preview === null ? (
          <PlayerAvatar decorative organizationId={organizationId} player={player} size={96} />
        ) : (
          <img alt="" className="inline-block h-24 w-24 shrink-0 rounded-full object-cover" src={preview.url} />
        )}
        <div className="flex flex-col gap-2">
          {/* Fokussierbar ist nur das (unsichtbare) Eingabefeld; das
              sichtbare Label rein optisch, ohne native Fokus-Semantik. Ein
              Tastaturnutzer, der auf das Feld tabbt, muss die Markierung
              trotzdem SEHEN — deshalb `peer` auf dem Eingabefeld und
              `peer-focus-visible:*` auf dem Label, das dafür im DOM hinter
              dem Eingabefeld stehen muss (CSS-Geschwisterselektoren wirken
              nur vorwärts). `buttonVariants({ variant: "outline" })` statt
              einer Handkopie der Button-Stile, damit ein Wechsel dort nicht
              still auseinanderläuft. */}
          <input
            accept="image/*"
            className="peer sr-only"
            id={`player-avatar-file-${player.id}`}
            onChange={(event) => void handleFileChange(event)}
            ref={fileInputRef}
            type="file"
          />
          <label
            className={cn(
              buttonVariants({ variant: "outline" }),
              "w-fit cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-400 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-slate-950",
            )}
            htmlFor={`player-avatar-file-${player.id}`}
          >
            Bild auswählen
          </label>
          <div className="flex flex-wrap gap-2">
            {preview !== null ? (
              <>
                <Button disabled={uploadAvatar.isPending} onClick={() => uploadAvatar.mutate(preview.blob)}>
                  Bild speichern
                </Button>
                <Button disabled={uploadAvatar.isPending} onClick={clearSelection} variant="outline">
                  Abbrechen
                </Button>
              </>
            ) : player.avatarChecksum !== null ? (
              <Button disabled={removeAvatar.isPending} onClick={() => removeAvatar.mutate()} variant="outline">
                Bild entfernen
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {errorMessage !== null ? (
        <p className="text-body text-rose-300" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
