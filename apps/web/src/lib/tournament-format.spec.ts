import { describe, expect, it } from "vitest";

import { calendarDate, calendarDateNumeric, clockTime, statusLabel } from "./tournament-format";

/**
 * Die Anwurfzeit wird als Lokalzeit erfasst (`datetime-local`) und muss als
 * dieselbe Lokalzeit wieder erscheinen. Vorher wurde auf UTC formatiert: ein
 * auf 20:00 angesetzter Spielabend stand im Sommer als 18:00 da.
 *
 * Die Erwartungen sind bewusst als absolute Zeichenketten notiert. Sie dürfen
 * nicht von der Systemzeitzone des Testlaufs abhängen — genau das ist die
 * Eigenschaft, die Server- und Client-Render zusammenhält.
 */
describe("Zeit- und Datumsausgabe", () => {
  it("gibt eine Sommerzeit-Ansetzung in Hallenzeit aus, nicht in UTC", () => {
    // 20:00 in Zürich am 10. September 2026 ist 18:00 UTC (CEST, +2).
    expect(clockTime(new Date("2026-09-10T18:00:00.000Z"))).toBe("20:00");
    expect(calendarDate(new Date("2026-09-10T18:00:00.000Z"))).toBe("10. September 2026");
  });

  it("rechnet Winterzeit mit dem kleineren Versatz", () => {
    // 19:00 in Zürich am 15. Januar 2026 ist 18:00 UTC (CET, +1).
    expect(clockTime(new Date("2026-01-15T18:00:00.000Z"))).toBe("19:00");
    expect(calendarDate(new Date("2026-01-15T18:00:00.000Z"))).toBe("15. Januar 2026");
  });

  it("verschiebt das Datum mit, wenn die Hallenzeit den Tag wechselt", () => {
    // 22:30 UTC ist in Zürich bereits 00:30 des Folgetags.
    const lateVisit = new Date("2026-09-10T22:30:00.000Z");
    expect(clockTime(lateVisit)).toBe("00:30");
    expect(calendarDate(lateVisit)).toBe("11. September 2026");
  });

  it("schreibt Mitternacht als 00:00 und nicht als 24:00", () => {
    expect(clockTime(new Date("2026-09-10T22:00:00.000Z"))).toBe("00:00");
  });

  it("lässt beim Tag die führende Null weg und beim numerischen Format stehen", () => {
    const earlyMonth = new Date("2026-09-02T10:00:00.000Z");
    expect(calendarDate(earlyMonth)).toBe("2. September 2026");
    expect(calendarDateNumeric(earlyMonth)).toBe("02.09.2026");
  });

  it("trifft die Umstellungsnacht auf beiden Seiten", () => {
    // Die Sommerzeit endet 2026 am 25. Oktober um 03:00 Lokalzeit.
    expect(clockTime(new Date("2026-10-24T22:00:00.000Z"))).toBe("00:00");
    expect(clockTime(new Date("2026-10-25T22:00:00.000Z"))).toBe("23:00");
  });
});

describe("statusLabel", () => {
  // Nebenbeobachtung aus der Sichtprobe vom 25.09.2026: Jeder gegen jeden
  // laeuft technisch als GROUP_STAGE, hat aber keine Gruppenphase.
  it("nennt die Gruppenphase nur bei Formaten mit Gruppen", () => {
    expect(statusLabel("GROUP_STAGE")).toBe("Gruppenphase");
    expect(statusLabel("GROUP_STAGE", "GROUPS_THEN_KNOCKOUT")).toBe("Gruppenphase");
    expect(statusLabel("GROUP_STAGE", "ROUND_ROBIN")).toBe("läuft");
    expect(statusLabel("COMPLETED", "ROUND_ROBIN")).toBe("beendet");
  });
});
