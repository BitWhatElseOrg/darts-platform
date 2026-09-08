import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicTournamentDashboard } from "@darts-platform/schemas";

import { PublicTournamentsController } from "./public-tournaments.controller.js";
import { TournamentsService } from "./tournaments.service.js";

/**
 * Abweichung vom Aufgabenzettel: der dort skizzierte Test ruft
 * Controller-Methoden direkt auf einem Testdoppel (`new Controller(fake as
 * Service)`) auf. Dieser Bestand kennt dieses Muster nicht — der einzige
 * bestehende Controller-Test (`health.controller.spec.ts`) baut die
 * Anwendung ueber `Nest.Testing` und prueft per `app.inject` echte
 * HTTP-Anfragen. Nur so durchlaeuft der Test Nests echtes Routing und kann
 * eine Verschattung zwischen `:publicId/live` und `:tournamentId/address`
 * tatsaechlich aufdecken statt sie zu unterstellen; ein direkter
 * Methodenaufruf wuerde daran vorbeigehen.
 */
describe("PublicTournamentsController", () => {
  let app: NestFastifyApplication;

  const transitionTargetPublicId = "6f1f1f6a-0000-4000-8000-000000000002";

  const dashboardFixture = (publicId: string): PublicTournamentDashboard => ({
    tournament: {
      publicId,
      name: "Herbstturnier",
      status: "READY",
      format: "SINGLE_ELIMINATION",
      version: 1,
      stageLabel: "Hauptrunde",
      startingScore: 501,
      inRule: "STRAIGHT",
      outRule: "DOUBLE",
      playedMatches: 0,
      totalMatches: 4,
      startsAt: new Date("2026-10-01T18:00:00.000Z"),
    },
    participants: [],
    boards: [],
    queue: [],
    groups: [],
    bracket: [],
    recentResults: [],
    generatedAt: new Date("2026-09-07T12:00:00.000Z"),
  });

  const publicDashboard = vi.fn(
    async (publicId: string): Promise<PublicTournamentDashboard> => dashboardFixture(publicId),
  );
  const publicAddress = vi.fn(
    async (): Promise<{ readonly publicId: string }> => ({
      publicId: transitionTargetPublicId,
    }),
  );

  beforeEach(async () => {
    publicDashboard.mockClear();
    publicAddress.mockClear();

    const moduleReference = await Test.createTestingModule({
      controllers: [PublicTournamentsController],
      providers: [{ provide: TournamentsService, useValue: { publicDashboard, publicAddress } }],
    }).compile();

    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("reicht die publicId an den Service durch und antwortet unter :publicId/live", async () => {
    const publicId = "6f1f1f6a-0000-4000-8000-000000000001";

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/public/tournaments/${publicId}/live`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<PublicTournamentDashboard>().tournament.publicId).toBe(publicId);
    expect(publicDashboard).toHaveBeenCalledWith(publicId, undefined);
  });

  it("reicht den Anzeige-Schluessel aus der Query an den Service durch", async () => {
    const publicId = "6f1f1f6a-0000-4000-8000-000000000006";

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/public/tournaments/${publicId}/live?k=ein-schluessel`,
    });

    expect(response.statusCode).toBe(200);
    expect(publicDashboard).toHaveBeenCalledWith(publicId, "ein-schluessel");
  });

  it("liefert zu einer internen ID unter :tournamentId/address die oeffentliche Adresse", async () => {
    const internalId = "6f1f1f6a-0000-4000-8000-000000000003";

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/public/tournaments/${internalId}/address`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ publicId: transitionTargetPublicId });
    expect(publicAddress).toHaveBeenCalledWith(internalId);
  });

  it("gibt fuer eine unbekannte oder nicht oeffentliche interne ID nichts preis", async () => {
    publicAddress.mockRejectedValueOnce(new NotFoundException("Turnier nicht gefunden."));

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/public/tournaments/6f1f1f6a-0000-4000-8000-000000000004/address",
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ readonly message: string }>();
    expect(body.message).toBe("Turnier nicht gefunden.");
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  it("verschattet :publicId/live nicht durch :tournamentId/address und umgekehrt", async () => {
    const id = "6f1f1f6a-0000-4000-8000-000000000005";

    const liveResponse = await app.inject({
      method: "GET",
      url: `/api/v1/public/tournaments/${id}/live`,
    });
    const addressResponse = await app.inject({
      method: "GET",
      url: `/api/v1/public/tournaments/${id}/address`,
    });

    expect(liveResponse.statusCode).toBe(200);
    expect(addressResponse.statusCode).toBe(200);
    expect(publicDashboard).toHaveBeenCalledWith(id, undefined);
    expect(publicAddress).toHaveBeenCalledWith(id);
    expect(addressResponse.json()).toEqual({ publicId: transitionTargetPublicId });
    expect(liveResponse.json<PublicTournamentDashboard>().tournament.publicId).toBe(id);
  });
});
