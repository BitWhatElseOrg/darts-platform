import type { Metadata } from "next";

import { ResetPasswordRoute } from "@/components/auth/reset-password-route";

export const metadata: Metadata = {
  title: "Neues Passwort",
  description: "Ein neues Passwort für das DartBase-Konto setzen.",
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const token = typeof query.token === "string" && query.token.length > 0 ? query.token : null;
  const invalid = query.error === "INVALID_TOKEN";

  return (
    <main className="flex min-h-screen justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-xl">
        <ResetPasswordRoute invalid={invalid} token={token} />
      </div>
    </main>
  );
}
