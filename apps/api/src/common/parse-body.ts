import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);

  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    throw new BadRequestException(message);
  }

  return result.data;
}
