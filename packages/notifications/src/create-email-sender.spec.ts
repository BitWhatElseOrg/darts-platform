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
