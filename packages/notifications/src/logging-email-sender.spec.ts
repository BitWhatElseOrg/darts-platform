import { describe, expect, it, vi } from "vitest";

import { LoggingEmailSender } from "./logging-email-sender.js";

describe("LoggingEmailSender", () => {
  it("loggt Empfaenger, Betreff und Text und meldet Erfolg mit einer lokalen ID", async () => {
    const emit = vi.fn();
    const sender = new LoggingEmailSender({ emit });

    const result = await sender.send(
      { to: "gast@example.test", subject: "Hallo", text: "Inhalt", html: "<p>Inhalt</p>" },
      "delivery-7",
    );

    expect(result).toEqual({ kind: "sent", providerMessageId: "log:delivery-7" });
    expect(emit).toHaveBeenCalledWith("log", {
      event: "email.logged",
      to: "gast@example.test",
      subject: "Hallo",
      text: "Inhalt",
      idempotencyKey: "delivery-7",
    });
  });
});
