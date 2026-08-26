import { parsePublicWebEnvironment } from "@darts-platform/config";

export const publicEnvironment = parsePublicWebEnvironment({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});
