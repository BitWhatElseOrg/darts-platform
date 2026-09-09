"use client";

import { useQuery } from "@tanstack/react-query";

import { StateTag } from "@darts-platform/ui";

import { fetchHealth } from "@/lib/health";

type DisplayStatus = "ok" | "error" | "pending";

const statusTone = {
  ok: "free",
  error: "blocked",
  pending: "waiting",
} as const satisfies Record<DisplayStatus, "free" | "blocked" | "waiting">;

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

  const statuses = [apiStatus, databaseStatus, redisStatus];
  const worst: DisplayStatus = statuses.includes("error")
    ? "error"
    : statuses.includes("pending")
      ? "pending"
      : "ok";
  const compactLabel = {
    ok: "Dienste betriebsbereit",
    error: "Dienststörung",
    pending: "Dienste werden geprüft …",
  } as const satisfies Record<DisplayStatus, string>;
  return <StateTag label={compactLabel[worst]} on="ink" tone={statusTone[worst]} />;
}
