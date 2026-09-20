import { describe, expect, it, vi } from "vitest";

import { createEmailSender } from "./create-email-sender.js";
import { LoggingEmailSender } from "./logging-email-sender.js";
import { ResendEmailSender } from "./resend-email-sender.js";

const logger = { emit: vi.fn() };

describe("createEmailSender", () => {
  it("liefert fuer log den Log-Adapter", () => {
    expect(createEmailSender({ provider: "log", apiKey: undefined, from: "x <x@y.z>" }, logger)).toBeInstanceOf(
      LoggingEmailSender,
    );
  });

  it("reicht redactBody an den Log-Adapter durch", async () => {
    const emit = vi.fn();
    const sender = createEmailSender(
      { provider: "log", apiKey: undefined, from: "x <x@y.z>", redactBody: true },
      { emit },
    );

    await sender.send({ to: "a@b.test", subject: "Betreff", text: "Link", html: "<p></p>" }, "k1");

    expect(emit).toHaveBeenCalledWith("log", {
      event: "email.logged",
      subject: "Betreff",
      idempotencyKey: "k1",
      redacted: true,
    });
  });

  it("liefert fuer resend den Resend-Adapter", () => {
    expect(createEmailSender({ provider: "resend", apiKey: "re_1", from: "x <x@y.z>" }, logger)).toBeInstanceOf(
      ResendEmailSender,
    );
  });

  it("wirft bei resend ohne Key, statt still zu loggen", () => {
    expect(() => createEmailSender({ provider: "resend", apiKey: undefined, from: "x <x@y.z>" }, logger)).toThrow(
      /RESEND_API_KEY/u,
    );
  });
});
