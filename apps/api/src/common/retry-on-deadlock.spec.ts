import { describe, expect, it } from "vitest";

import { retryOnDeadlock } from "./retry-on-deadlock.js";

function deadlock(): Error {
  return new Error("Failed query", { cause: { code: "40P01", message: "deadlock detected" } });
}

describe("retryOnDeadlock", () => {
  it("wiederholt einen abgebrochenen Vorgang genau einmal", async () => {
    let calls = 0;
    const command = async (): Promise<"ok"> => {
      calls += 1;
      if (calls === 1) throw deadlock();
      return "ok";
    };

    await expect(retryOnDeadlock(command, "version-conflict")).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  it("meldet nach dem zweiten Zyklus einen Versionskonflikt statt eines Serverfehlers", async () => {
    let calls = 0;
    const command = async (): Promise<"ok"> => {
      calls += 1;
      throw deadlock();
    };

    await expect(retryOnDeadlock(command, "version-conflict")).resolves.toBe("version-conflict");
    expect(calls).toBe(2);
  });

  it("reicht jeden anderen Fehler unveraendert durch", async () => {
    const failure = new Error("Failed query", { cause: { code: "23505" } });

    await expect(retryOnDeadlock(async () => { throw failure; }, "version-conflict")).rejects.toBe(failure);
  });
});
