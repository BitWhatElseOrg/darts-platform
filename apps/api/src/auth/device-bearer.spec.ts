import { describe, expect, it } from "vitest";

import { readDeviceBearer } from "./device-bearer.js";

describe("readDeviceBearer", () => {
  it("liest einen bd_-Schlüssel", () => {
    expect(readDeviceBearer({ authorization: "Bearer bd_abc" })).toBe("bd_abc");
  });

  it("ignoriert Gross-/Kleinschreibung des Schemas", () => {
    expect(readDeviceBearer({ authorization: "bearer bd_abc" })).toBe("bd_abc");
  });

  it("ignoriert fehlende und fremde Header", () => {
    expect(readDeviceBearer({})).toBeNull();
    expect(readDeviceBearer({ authorization: "Bearer xyz" })).toBeNull();
    expect(readDeviceBearer({ authorization: "Basic bd_abc" })).toBeNull();
  });
});
