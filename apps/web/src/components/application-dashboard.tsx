"use client";

import { AuthPanel } from "@/components/auth-panel";
import { AuthFooter } from "@/components/auth-footer";
import { HealthDashboard } from "@/components/health-dashboard";
import { TenantDashboard } from "@/components/tenant-dashboard";
import { authClient } from "@/lib/auth-client";

export function ApplicationDashboard() {
  const session = authClient.useSession();

  if (session.isPending) {
    return (
      <p className="min-h-24 text-center text-body text-slate-400" role="status">
        Sitzung wird geladen …
      </p>
    );
  }

  if (session.data === null) {
    return (
      <div className="w-full">
        <div className="mx-auto w-full max-w-xl">
          <AuthPanel onAuthenticated={session.refetch} />
        </div>
        <p className="mt-4 flex justify-center">
          <HealthDashboard />
        </p>
        <AuthFooter />
      </div>
    );
  }

  return (
    <TenantDashboard
      userEmail={session.data.user.email}
      userName={session.data.user.name}
      onSignOut={async () => {
        await authClient.signOut();
        await session.refetch();
      }}
    />
  );
}
