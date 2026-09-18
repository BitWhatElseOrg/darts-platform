import { Logger } from "@nestjs/common";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { ApiLoggingInterceptor } from "./api-logging.interceptor.js";

describe("ApiLoggingInterceptor", () => {
  async function runIntercept(
    interceptor: ApiLoggingInterceptor,
    request: Record<string, unknown>,
  ): Promise<void> {
    const context = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 200 }) }),
    };

    await new Promise<void>((resolve) => {
      interceptor
        .intercept(context as never, { handle: () => of(null) })
        .subscribe({ complete: resolve });
    });
  }

  it("protokolliert request.ip, die aufgeloeste Client-Adresse und die rohen Adress-Header, wenn LOG_CLIENT_ADDRESS gesetzt ist", async () => {
    const logger = { log: vi.fn() } as unknown as Logger;
    // trustProxyHops=0 explizit: kein Default mehr (Fix-Runde 1) — ohne
    // vertrauten Hop entspricht `clientAddress` `request.ip`.
    const interceptor = new ApiLoggingInterceptor(logger, true, 0);
    const request = {
      method: "GET",
      url: "/api/v1/health",
      ip: "10.0.0.5",
      headers: { "x-real-ip": "203.0.113.10", "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
    };

    await runIntercept(interceptor, request);

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "http_request_completed",
        ip: "10.0.0.5",
        clientAddress: "10.0.0.5",
        addressHeaders: { "x-real-ip": "203.0.113.10", "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
      }),
      "ApiLoggingInterceptor",
    );
  });

  it("laesst ip, clientAddress und addressHeaders weg, wenn LOG_CLIENT_ADDRESS deaktiviert ist", async () => {
    const logger = { log: vi.fn() } as unknown as Logger;
    const interceptor = new ApiLoggingInterceptor(logger, false, 0);
    const request = {
      method: "GET",
      url: "/api/v1/health",
      ip: "10.0.0.5",
      headers: { "x-real-ip": "203.0.113.10", "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
    };

    await runIntercept(interceptor, request);

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: "http_request_completed" }),
      "ApiLoggingInterceptor",
    );
    const loggedObject = (logger.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(loggedObject).not.toHaveProperty("ip");
    expect(loggedObject).not.toHaveProperty("clientAddress");
    expect(loggedObject).not.toHaveProperty("addressHeaders");
  });

  it("kuerzt einen ueberlangen x-forwarded-for-Header auf 200 Zeichen", async () => {
    const logger = { log: vi.fn() } as unknown as Logger;
    const interceptor = new ApiLoggingInterceptor(logger, true, 0);
    const longHeader = "1.2.3.4, ".repeat(34); // > 300 Zeichen
    const request = {
      method: "GET",
      url: "/api/v1/health",
      ip: "10.0.0.5",
      headers: { "x-forwarded-for": longHeader },
    };

    await runIntercept(interceptor, request);

    const loggedObject = (logger.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      addressHeaders: { "x-forwarded-for": string };
    };
    expect(loggedObject.addressHeaders["x-forwarded-for"]).toHaveLength(201);
    expect(loggedObject.addressHeaders["x-forwarded-for"].endsWith("…")).toBe(true);
    expect(loggedObject.addressHeaders["x-forwarded-for"].startsWith(longHeader.slice(0, 200))).toBe(
      true,
    );
  });
});
