import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { collectRoutes, type RouteEntry } from "./route-inventory.js";

let app: NestFastifyApplication;
let routes: readonly RouteEntry[];

beforeAll(async () => {
  ({ app, routes } = await collectRoutes());
}, 60_000);

afterAll(async () => {
  await app.close();
});

describe("Routeninventar", () => {
  it("enthält bekannte Routen mit vollem Präfix", () => {
    expect(routes).toContainEqual({ method: "GET", url: "/api/v1/health" });
    expect(routes).toContainEqual({ method: "POST", url: "/api/v1/organizations/:organizationId/matches/:matchId/visits" });
  });

  it("enthält keine HEAD- oder OPTIONS-Einträge", () => {
    expect(routes.some((route) => route.method === "HEAD" || route.method === "OPTIONS")).toBe(false);
  });

  it("kennt mindestens 60 Routen", () => {
    expect(routes.length).toBeGreaterThanOrEqual(60);
  });
});
