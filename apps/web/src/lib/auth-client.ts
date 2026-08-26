import { createAuthClient } from "better-auth/react";

import { publicEnvironment } from "./environment";

export const authClient = createAuthClient({
  baseURL: `${publicEnvironment.NEXT_PUBLIC_API_URL}/auth`,
  fetchOptions: {
    credentials: "include",
  },
});
