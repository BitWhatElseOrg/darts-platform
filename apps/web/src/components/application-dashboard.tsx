"use client";

import { AuthPanel } from "@/components/auth-panel";
import { HealthDashboard } from "@/components/health-dashboard";
import { TenantDashboard } from "@/components/tenant-dashboard";
import { authClient } from "@/lib/auth-client";

export function ApplicationDashboard() {
  const session = authClient.useSession();

  if (session.isPending) {
    return (
      <p className="min-h-24 text-center text-sm text-slate-400" role="status">
        Sitzung wird geladen …
      </p>
    );
  }

  if (session.data === null) {
    return (
      <div className="grid w-full gap-6 lg:grid-cols-2">
        <AuthPanel onAuthenticated={session.refetch} />
        <HealthDashboard />
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
