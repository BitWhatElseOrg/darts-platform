import { describe, expect, it, vi } from "vitest";

import { RESEND_EMAILS_ENDPOINT, ResendEmailSender } from "./resend-email-sender.js";

const message = {
  to: "gast@example.test",
  subject: "Betreff",
  text: "Text",
  html: "<p>Text</p>",
};

function senderWith(response: () => Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(response);
  const sender = new ResendEmailSender({
    apiKey: "re_test",
    from: "dartbase <noreply@dartbase.ch>",
    fetch: fetchMock,
    timeoutMs: 1_000,
  });
  return { sender, fetchMock };
}

describe("ResendEmailSender", () => {
  it("sendet an den Resend-Endpunkt mit Auth-, Idempotency- und Content-Type-Header", async () => {
    const { sender, fetchMock } = senderWith(async () =>
      new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }),
    );

    const result = await sender.send(message, "delivery-1");

    expect(result).toEqual({ kind: "sent", providerMessageId: "msg_1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(RESEND_EMAILS_ENDPOINT);
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer re_test");
    expect(headers.get("idempotency-key")).toBe("delivery-1");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "dartbase <noreply@dartbase.ch>",
      to: ["gast@example.test"],
      subject: "Betreff",
      text: "Text",
      html: "<p>Text</p>",
    });
  });

  it("behandelt 429, 409 und 5xx als wiederholbar", async () => {
    for (const status of [429, 409, 500, 503]) {
      const { sender } = senderWith(async () =>
        new Response(JSON.stringify({ name: "rate_limit_exceeded", message: "slow down" }), { status }),
      );
      const result = await sender.send(message, "d");
      expect(result.kind).toBe("retryable");
      if (result.kind === "retryable") expect(result.reason).toContain(String(status));
    }
  });

  it("behandelt andere 4xx als endgueltig abgelehnt und nennt den Grund", async () => {
    const { sender } = senderWith(async () =>
      new Response(JSON.stringify({ name: "validation_error", message: "Invalid `to` field" }), { status: 422 }),
    );
    const result = await sender.send(message, "d");
    expect(result).toEqual({ kind: "rejected", reason: "422 validation_error: Invalid `to` field" });
  });

  it("behandelt Netzwerkfehler als wiederholbar", async () => {
    const { sender } = senderWith(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await sender.send(message, "d");
    expect(result).toEqual({ kind: "retryable", reason: "fetch failed" });
  });

  it("wertet einen Erfolg ohne ID als wiederholbar, statt eine leere ID zu buchen", async () => {
    const { sender } = senderWith(async () => new Response("{}", { status: 200 }));
    const result = await sender.send(message, "d");
    expect(result.kind).toBe("retryable");
  });
});
