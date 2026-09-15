"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { createPlayerSchema, playerSchema } from "@darts-platform/schemas";
import { Button } from "@darts-platform/ui";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";

import { inputClassName, labelClassName } from "./form-styles";

const playerFormSchema = createPlayerSchema.pick({ displayName: true, nickname: true });

type PlayerFormData = z.infer<typeof playerFormSchema>;

export function PlayerForm({ organizationId }: { readonly organizationId: string }) {
  const queryClient = useQueryClient();
  const form = useForm<PlayerFormData>({
    resolver: zodResolver(playerFormSchema),
    defaultValues: { displayName: "", nickname: null },
  });
  const createPlayer = useMutation({
    mutationFn: (data: PlayerFormData) =>
      apiRequest({
        path: `/organizations/${organizationId}/players`,
        method: "POST",
        body: data,
        schema: playerSchema,
      }),
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["players", organizationId] });
    },
  });

  return (
    <>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(event) => void form.handleSubmit((data) => createPlayer.mutate(data))(event)}
      >
        <div className="space-y-2">
          <label className={labelClassName} htmlFor="player-display-name">Anzeigename</label>
          <input id="player-display-name" className={inputClassName} placeholder="Anzeigename" {...form.register("displayName")} />
        </div>
        <div className="space-y-2">
          <label className={labelClassName} htmlFor="player-nickname">Spitzname (optional)</label>
          <input id="player-nickname" className={inputClassName} placeholder="Spitzname (optional)" {...form.register("nickname")} />
        </div>
        <Button disabled={createPlayer.isPending} type="submit">Spieler hinzufügen</Button>
      </form>

      {createPlayer.isError ? (
        <p role="alert" className="text-body text-rose-300">{userFacingErrorMessage(createPlayer.error)}</p>
      ) : null}
    </>
  );
}
