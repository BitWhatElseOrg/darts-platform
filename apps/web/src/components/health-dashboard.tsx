"use client";

import { useQuery } from "@tanstack/react-query";

import { Button, cn } from "@darts-platform/ui";

import { fetchHealth } from "@/lib/health";

type DisplayStatus = "ok" | "error" | "pending";

interface StatusRowProps {
  readonly label: string;
  readonly status: DisplayStatus;
}

const statusLabels = {
  ok: "OK",
  error: "Nicht verfügbar",
  pending: "Wird geprüft …",
} as const satisfies Record<DisplayStatus, string>;

function StatusRow({ label, status }: StatusRowProps) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-6 border-b border-slate-800 py-3 last:border-0">
      <dt className="text-sm font-medium text-slate-300">{label}</dt>
      <dd
        className={cn(
          "inline-flex items-center gap-2 text-sm font-semibold",
          status === "ok" && "text-emerald-300",
          status === "error" && "text-rose-300",
          status === "pending" && "text-amber-200",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-2.5 rounded-full",
            status === "ok" && "bg-emerald-400",
            status === "error" && "bg-rose-400",
            status === "pending" && "animate-pulse bg-amber-300",
          )}
        />
        {statusLabels[status]}
      </dd>
    </div>
  );
}

export function HealthDashboard() {
  const healthQuery = useQuery({
    queryKey: ["system-health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 10_000,
  });

  const apiStatus: DisplayStatus = healthQuery.isPending
    ? "pending"
    : healthQuery.isError
      ? "error"
      : "ok";
  const databaseStatus: DisplayStatus = healthQuery.isPending
    ? "pending"
    : healthQuery.data?.services.database === "ok"
      ? "ok"
      : "error";
  const redisStatus: DisplayStatus = healthQuery.isPending
    ? "pending"
    : healthQuery.data?.services.redis === "ok"
      ? "ok"
      : "error";

  return (
    <section
      aria-labelledby="environment-title"
      className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-8"
    >
      <div className="mb-5 flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold tracking-[0.2em] text-emerald-300 uppercase">
            Systemstatus
          </p>
          <h2 id="environment-title" className="text-xl font-semibold text-white">
            Entwicklungsumgebung
          </h2>
        </div>
        <Button
          aria-label="Dienststatus aktualisieren"
          disabled={healthQuery.isFetching}
          onClick={() => void healthQuery.refetch()}
          variant="outline"
        >
          {healthQuery.isFetching ? "Wird aktualisiert …" : "Aktualisieren"}
        </Button>
      </div>

      <dl aria-live="polite">
        <StatusRow label="Web" status="ok" />
        <StatusRow label="API" status={apiStatus} />
        <StatusRow label="Datenbank" status={databaseStatus} />
        <StatusRow label="Redis" status={redisStatus} />
      </dl>

      {healthQuery.isError ? (
        <p className="mt-5 rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">
          Der API-Systemstatus ist nicht erreichbar. Prüfe, ob API und lokale
          Infrastruktur laufen.
        </p>
      ) : null}
    </section>
  );
}
