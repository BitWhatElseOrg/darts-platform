import type { Metadata } from "next";

import { ForgotPasswordRoute } from "@/components/auth/forgot-password-route";

export const metadata: Metadata = {
  title: "Passwort vergessen",
  description: "Einen Link zum Zurücksetzen des Passworts anfordern.",
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-xl">
        <ForgotPasswordRoute />
      </div>
    </main>
  );
}
