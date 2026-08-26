import { healthResponseSchema, type HealthResponse } from "@darts-platform/schemas";

import { publicEnvironment } from "./environment";

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${publicEnvironment.NEXT_PUBLIC_API_URL}/health`, {
    headers: {
      Accept: "application/json",
    },
    signal: signal ?? null,
  });

  if (!response.ok) {
    throw new Error(`Health endpoint returned HTTP ${response.status}.`);
  }

  const payload: unknown = await response.json();
  return healthResponseSchema.parse(payload);
}
