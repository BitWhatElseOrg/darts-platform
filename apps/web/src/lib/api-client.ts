import { z } from "zod";

import { apiErrorSchema } from "@darts-platform/schemas";

import { publicEnvironment } from "./environment";

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly correlationId: string | null;

  public constructor(
    message: string,
    code = "REQUEST_FAILED",
    correlationId: string | null = null,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.correlationId = correlationId;
  }
}

export async function apiRequest<T>(input: {
  readonly path: string;
  readonly schema: z.ZodType<T>;
  readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}): Promise<T> {
  const response = await fetch(
    `${publicEnvironment.NEXT_PUBLIC_API_URL}${input.path}`,
    {
      method: input.method ?? "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      signal: input.signal ?? null,
    },
  );

  const payload: unknown = await response.json();

  if (!response.ok) {
    const error = apiErrorSchema.safeParse(payload);
    if (error.success) {
      throw new ApiClientError(
        error.data.error.message,
        error.data.error.code,
        error.data.error.correlationId,
      );
    }
    throw new ApiClientError(`API request returned HTTP ${response.status}.`);
  }

  return input.schema.parse(payload);
}
