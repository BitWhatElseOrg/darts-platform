import { Logger } from "@nestjs/common";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { ApiLoggingInterceptor } from "./api-logging.interceptor.js";

describe("ApiLoggingInterceptor", () => {
  it("protokolliert request.ip und die rohen Adress-Header", async () => {
    const logger = { log: vi.fn() } as unknown as Logger;
    const interceptor = new ApiLoggingInterceptor(logger);
    const request = {
      method: "GET",
      url: "/api/v1/health",
      ip: "10.0.0.5",
      headers: { "x-real-ip": "203.0.113.10", "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 200 }) }),
    };

    await new Promise<void>((resolve) => {
      interceptor
        .intercept(context as never, { handle: () => of(null) })
        .subscribe({ complete: resolve });
    });

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "http_request_completed",
        ip: "10.0.0.5",
        addressHeaders: { "x-real-ip": "203.0.113.10", "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
      }),
      "ApiLoggingInterceptor",
    );
  });
});
