import { describe, expect, it } from "vitest";

import { renderPasswordResetEmail } from "./password-reset-email.js";

const input = {
  recipientName: "Alex Muster",
  resetUrl: "https://api.dartbase.example/api/v1/auth/reset-password/tok?callbackURL=https%3A%2F%2Fdartbase.example%2Fpasswort%2Fneu",
};

describe("renderPasswordResetEmail", () => {
  it("nennt den Link und die Gueltigkeit von einer Stunde", () => {
    const email = renderPasswordResetEmail(input);
    expect(email.subject).toBe("Passwort zurücksetzen auf DartBase");
    expect(email.text).toContain(input.resetUrl);
    expect(email.text).toContain("eine Stunde");
    expect(email.html).toContain(`href="${input.resetUrl}"`);
  });

  it("escaped den Namen im HTML", () => {
    const email = renderPasswordResetEmail({ ...input, recipientName: `Alex "Ace" <Muster>` });
    expect(email.html).toContain("Alex &quot;Ace&quot; &lt;Muster&gt;");
  });
});
