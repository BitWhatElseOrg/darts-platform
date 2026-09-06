import { describe, expect, it, vi } from "vitest";

import { ApiClientError } from "./api-error";
import type { OfflineCommand } from "./offline-command-queue";
import {
  localCleanupFailureMessage,
  nextReplayable,
  queueBlocksControl,
  queueHidesEntries,
  queueReadFailureMessage,
  queueSaveFailureMessage,
  queueUpdateFailureMessage,
  queuedCommandNotice,
  replayAnnouncement,
  replayChained,
  replayFailure,
  withCurrentExpectedVersion,
  type ReplayOutcome,
} from "./offline-replay";

function command(overrides: Partial<OfflineCommand> = {}): OfflineCommand {
  return {
    commandId: "c1",
    scope: "match:org:match",
    path: "/organizations/org/matches/match/visits",
    body: {},
    label: "60 Punkte",
    createdAt: "2026-09-06T10:00:00.000Z",
    status: "PENDING",
    error: null,
    ...overrides,
  };
}

/** Antwort der API mit Fehlerformat, wie `apiRequest` sie wirft. */
function apiError(code: string, status: number, message = "egal"): ApiClientError {
  return new ApiClientError(message, code, null, undefined, status);
}

describe("replayFailure", () => {
  it("laesst einen Netzwerkfehler in der Warteschlange", () => {
    expect(replayFailure(new TypeError("Failed to fetch"))).toEqual({ kind: "RETRY" });
  });

  /**
   * Ein `SyntaxError` erreicht `replayFailure` heute nur noch vom
   * ERFOLGSPFAD (2xx mit unlesbarem Koerper) oder von einem abgebrochenen
   * Transport -- der Fehlerpfad von `apiRequest` liest seit der Korrektur
   * zuerst den Status und wirft einen `ApiClientError` mit Status. Kein
   * Urteil des Servers ist beides nicht.
   */
  it("laesst eine nicht lesbare Antwort in der Warteschlange", () => {
    expect(replayFailure(new SyntaxError("Unexpected token < in JSON at position 0"))).toEqual({ kind: "RETRY" });
  });

  it("meldet die Konfliktcodes mit handlungsleitendem Text", () => {
    const versionConflict = replayFailure(apiError("MATCH_VERSION_CONFLICT", 409));
    expect(versionConflict.kind).toBe("CONFLICT");
    expect(versionConflict).toMatchObject({ code: "MATCH_VERSION_CONFLICT" });
    expect(replayFailure(apiError("BOARD_CONTROLLER_CONFLICT", 409)).kind).toBe("CONFLICT");
  });

  /**
   * Der Befund: vor dieser Unterscheidung blieb ein fachlich abgelehntes
   * Kommando dauerhaft `PENDING` und sperrte das Board.
   */
  it("erklaert eine fachliche Ablehnung (4xx mit Code) fuer endgueltig", () => {
    const rejected = replayFailure(
      apiError("DARTS_REQUIRED_FOR_DOUBLE_IN", 400, "Unter Double In wird die Eröffnungsaufnahme Wurf für Wurf erfasst."),
    );
    expect(rejected).toEqual({
      kind: "REJECTED",
      code: "DARTS_REQUIRED_FOR_DOUBLE_IN",
      message: "Unter Double In wird die Eröffnungsaufnahme Wurf für Wurf erfasst.",
    });
    expect(replayFailure(apiError("FORBIDDEN", 403)).kind).toBe("REJECTED");
  });

  /**
   * Befund B: Laeuft die Session waehrend der Wiedergabe ab, ist 401 kein
   * Urteil ueber das Kommando -- es bleibt `PENDING` und sichtbar, bis die
   * Person sich erneut anmeldet und die Wiedergabe erneut laeuft. 403 bleibt
   * `REJECTED`: fehlende Berechtigung behebt sich nicht durch einen erneuten
   * Versuch.
   */
  it("wiederholt bei abgelaufener Session (401), lehnt aber fehlende Berechtigung (403) endgueltig ab", () => {
    expect(replayFailure(apiError("UNAUTHORIZED", 401))).toEqual({ kind: "RETRY" });
    expect(replayFailure(apiError("FORBIDDEN", 403)).kind).toBe("REJECTED");
  });

  /**
   * Befund C1: Der API-Filter vergibt auch fuer 500/502/503 einen Fehlercode
   * (`errorCodes[status] ?? "INTERNAL_ERROR"`). Ohne den Status haette ein
   * Railway-Neustart waehrend der Wiedergabe eine von Hand erfasste Aufnahme
   * als „vom Server abgelehnt" markiert.
   */
  it("wiederholt eine Stoerung des Servers statt sie zu verwerfen", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(replayFailure(apiError("INTERNAL_ERROR", status))).toEqual({ kind: "RETRY" });
    }
  });

  it("wiederholt Zeitablauf und Drosselung", () => {
    expect(replayFailure(apiError("REQUEST_TIMEOUT", 408))).toEqual({ kind: "RETRY" });
    expect(replayFailure(apiError("TOO_MANY_REQUESTS", 429))).toEqual({ kind: "RETRY" });
  });

  it("wiederholt, solange kein Status bekannt ist", () => {
    expect(replayFailure(new ApiClientError("Die API hat nicht geantwortet.")).kind).toBe("RETRY");
  });
});

describe("nextReplayable", () => {
  /**
   * Befund I1: Ein Filter hielt die Reihenfolge nur im laufenden Durchgang.
   * Beim naechsten Auslöser ging der Nachfolger eines abgelehnten Kopfes
   * durch — die zweite Aufnahme stand in der Datenbank, die erste nicht.
   */
  it("liefert nichts, solange der Kopf abgelehnt ist", () => {
    expect(nextReplayable([
      command({ commandId: "c1", status: "REJECTED", error: "abgelehnt" }),
      command({ commandId: "c2", status: "PENDING" }),
    ])).toEqual([]);
  });

  it("bricht beim ersten nicht wartenden Kommando ab", () => {
    const commands = [
      command({ commandId: "c1", status: "PENDING" }),
      command({ commandId: "c2", status: "REJECTED", error: "abgelehnt" }),
      command({ commandId: "c3", status: "PENDING" }),
    ];
    expect(nextReplayable(commands).map((entry) => entry.commandId)).toEqual(["c1"]);
  });

  it("haelt auch ein Konfliktkommando die Warteschlange an", () => {
    expect(nextReplayable([
      command({ commandId: "c1", status: "CONFLICT", error: "Konflikt" }),
      command({ commandId: "c2", status: "PENDING" }),
    ])).toEqual([]);
  });

  it("liefert alle wartenden Kommandos, wenn keines im Weg steht", () => {
    const commands = [command({ commandId: "c1" }), command({ commandId: "c2" })];
    expect(nextReplayable(commands)).toEqual(commands);
    expect(nextReplayable([])).toEqual([]);
  });
});

describe("queueBlocksControl", () => {
  /** Nichts haengt lokal: der Normalfall. */
  const nothingStuck: ReadonlySet<string> = new Set();

  it("sperrt bei wartenden und bei konfliktbehafteten Kommandos", () => {
    expect(queueBlocksControl([command({ status: "PENDING" })], nothingStuck, null)).toBe(true);
    expect(queueBlocksControl([command({ status: "CONFLICT", error: "Konflikt" })], nothingStuck, null)).toBe(true);
  });

  it("sperrt nicht, wenn nur abgelehnte Kommandos uebrig sind", () => {
    expect(queueBlocksControl([command({ status: "REJECTED", error: "abgelehnt", code: "X" })], nothingStuck, null)).toBe(false);
    expect(queueBlocksControl([], nothingStuck, null)).toBe(false);
  });

  it("sperrt weiterhin, wenn hinter einem abgelehnten noch ein wartendes steht", () => {
    expect(queueBlocksControl([
      command({ commandId: "c1", status: "REJECTED", error: "abgelehnt", code: "X" }),
      command({ commandId: "c2", status: "PENDING" }),
    ], nothingStuck, null)).toBe(true);
  });

  /**
   * Runde 7: Der Server hat die Aufnahme angenommen, nur das lokale Entfernen
   * scheiterte. Sie steht damit nicht mehr vor dem Serverstand und darf die
   * Flaeche nicht sperren -- vorher blieb die Scoringflaeche in genau diesem
   * Fall dauerhaft unbedienbar.
   */
  it("sperrt nicht wegen eines wartenden Kommandos, das der Server angenommen hat", () => {
    const queued = [command({ commandId: "c1", status: "PENDING" })];
    expect(queueBlocksControl(queued, new Set(["c1"]), null)).toBe(false);
    expect(queueBlocksControl(queued, nothingStuck, null)).toBe(true);
  });

  it("sperrt weiterhin wegen eines anderen wartenden Kommandos daneben", () => {
    expect(queueBlocksControl([
      command({ commandId: "c1", status: "PENDING" }),
      command({ commandId: "c2", status: "PENDING" }),
    ], new Set(["c1"]), null)).toBe(true);
  });

  /**
   * PR-Agent-Rueckmeldung Runde 9, "Unsafe Control" / "Unsafe Assignment":
   * Ein Lesefehler kann Eintraege VERBERGEN -- `queued` erscheint dann leer
   * oder auf dem letzten guten Stand, obwohl in Wirklichkeit ein wartendes
   * Kommando dort steht. Vorher ignorierten sowohl `mayControl`
   * (use-match-scoring.ts) als auch die Zuweisungs-Controls der
   * Kommandozentrale genau diesen Fall: eine neue Aufnahme bzw. Zuweisung
   * konnte an einem versteckten Kommando vorbeilaufen. Die Sperre gilt
   * bedingungslos, unabhaengig davon, was `queued` gerade zeigt.
   */
  it("sperrt bei einem Lesefehler, auch wenn queued leer erscheint", () => {
    expect(queueBlocksControl([], nothingStuck, "Warteschlange nicht lesbar")).toBe(true);
    expect(queueBlocksControl(
      [command({ status: "REJECTED", error: "abgelehnt", code: "X" })],
      nothingStuck,
      "Warteschlange nicht lesbar",
    )).toBe(true);
  });

  /**
   * `writeError` ist bewusst KEIN Parameter dieser Funktion: ein gescheitertes
   * Schreiben laesst den betroffenen Eintrag unveraendert SICHTBAR stehen und
   * verbirgt -- anders als ein Lesefehler -- nichts (use-offline-queue.ts).
   * Ein Aufruf ohne Lesefehler und ohne wartende Kommandos bleibt deshalb
   * unbedenklich, ganz gleich, ob im umgebenden Zustand gerade ein
   * Schreibfehler ansteht.
   */
  it("sperrt nicht wegen eines Schreibfehlers allein", () => {
    expect(queueBlocksControl([], nothingStuck, null)).toBe(false);
  });
});

describe("queueHidesEntries", () => {
  /**
   * Befund A: Nach einer einzigen Offline-Zuweisung liessen sich in der
   * Kommandozentrale keine weiteren freien Boards oder Matches mehr zuweisen,
   * weil sie `queueBlocksControl` nutzte -- das sperrt bereits bei einem
   * einzelnen wartenden Kommando. Die Zentrale schuetzt Dubletten schon ueber
   * `pendingBoardIds`/`pendingMatchIds`; sie darf deshalb NICHT bei jedem
   * `PENDING`/`CONFLICT`-Eintrag sperren, sondern nur, wenn ein Zustand
   * Eintraege VERBERGEN kann -- heute ausschliesslich ein Lesefehler.
   */
  it("sperrt nicht bei einem wartenden Kommando", () => {
    expect(queueHidesEntries(null)).toBe(false);
  });

  it("sperrt bei einem Lesefehler", () => {
    expect(queueHidesEntries("Warteschlange nicht lesbar")).toBe(true);
  });
});

describe("localCleanupFailureMessage", () => {
  /**
   * PR-Agent-Befund F2: Ein Fehler bei der lokalen Nacharbeit einer bereits
   * vom Server angenommenen Zuweisung ist kein Uebertragungsfehler. Die
   * Meldung muss das benennen, statt wie `replayFailure` ein Serverurteil zu
   * simulieren.
   */
  it("benennt den Fehler als lokal, nicht als Uebertragungsfehler", () => {
    expect(localCleanupFailureMessage(new Error("IndexedDB nicht verfügbar")))
      .toBe(
        "Der Server hat den Befehl angenommen, die lokale Warteschlange konnte aber nicht aktualisiert werden (IndexedDB nicht verfügbar). Bitte Seite neu laden.",
      );
  });

  it("faellt auf einen generischen Hinweis zurueck, wenn kein Error-Objekt vorliegt", () => {
    expect(localCleanupFailureMessage("kaputt")).toBe(
      "Der Server hat den Befehl angenommen, die lokale Warteschlange konnte aber nicht aktualisiert werden (unbekannter Fehler). Bitte Seite neu laden.",
    );
  });
});

describe("queueSaveFailureMessage", () => {
  /**
   * PR-Agent-Runde 3, Befund A: Scheitert schon das Ablegen in der lokalen
   * Warteschlange (z.B. IndexedDB nicht verfuegbar), ist das Kommando weder
   * gesendet noch gespeichert. Ohne diese Meldung verschwaende es
   * kommentarlos -- versteckter Datenverlust (AGENTS.md §18).
   */
  it("benennt den Fehler als gescheiterte Warteschlangen-Ablage", () => {
    expect(queueSaveFailureMessage(new Error("IndexedDB nicht verfügbar"))).toBe(
      "Zuweisung konnte nicht in die Warteschlange gelegt werden (IndexedDB nicht verfügbar). Bitte Verbindung wiederherstellen und erneut versuchen.",
    );
  });

  it("faellt auf einen generischen Hinweis zurueck, wenn kein Error-Objekt vorliegt", () => {
    expect(queueSaveFailureMessage("kaputt")).toBe(
      "Zuweisung konnte nicht in die Warteschlange gelegt werden (unbekannter Fehler). Bitte Verbindung wiederherstellen und erneut versuchen.",
    );
  });

  /**
   * Runde 7: Die Scoringflaeche legt Aufnahmen ab, nicht Zuweisungen. Ihr
   * Offline-Zweig zeigte fuer einen IndexedDB-Fehler bis dahin die generische
   * Uebertragungsmeldung -- fuer ein Problem, bei dem nie etwas uebertragen
   * wurde.
   */
  it("benennt den abgelegten Gegenstand, wenn er nicht „Zuweisung“ heisst", () => {
    expect(queueSaveFailureMessage(new Error("Quota überschritten"), "Aufnahme")).toBe(
      "Aufnahme konnte nicht in die Warteschlange gelegt werden (Quota überschritten). Bitte Verbindung wiederherstellen und erneut versuchen.",
    );
  });
});

describe("queueReadFailureMessage", () => {
  /**
   * PR-Agent-Runde 5, Befund b: Scheitert schon das Lesen der Warteschlange,
   * sieht die Person eine leere Liste und haelt sie fuer leer -- wartende
   * Zuweisungen waeren still ausgelassen (AGENTS.md §18).
   */
  it("benennt den Fehler als gescheitertes Lesen und sagt, dass die Bedienung deshalb gesperrt ist", () => {
    expect(queueReadFailureMessage(new Error("IndexedDB blockiert"))).toBe(
      "Die Warteschlange konnte nicht gelesen werden (IndexedDB blockiert). Wartende Kommandos werden möglicherweise nicht angezeigt; deshalb ist die Bedienung gesperrt, bis das Lesen wieder gelingt. Lade die Seite neu.",
    );
  });

  it("faellt auf einen generischen Hinweis zurueck, wenn kein Error-Objekt vorliegt", () => {
    expect(queueReadFailureMessage("kaputt")).toBe(
      "Die Warteschlange konnte nicht gelesen werden (unbekannter Fehler). Wartende Kommandos werden möglicherweise nicht angezeigt; deshalb ist die Bedienung gesperrt, bis das Lesen wieder gelingt. Lade die Seite neu.",
    );
  });
});

describe("queueUpdateFailureMessage", () => {
  it("benennt den Fehler als gescheiterte Aenderung und sagt, dass der Eintrag stehen bleibt", () => {
    expect(queueUpdateFailureMessage(new Error("Quota überschritten"))).toBe(
      "Die Warteschlange konnte nicht geändert werden (Quota überschritten). Der Eintrag steht unverändert weiter in der Liste. Lade die Seite neu und versuche es erneut.",
    );
  });

  it("faellt auf einen generischen Hinweis zurueck, wenn kein Error-Objekt vorliegt", () => {
    expect(queueUpdateFailureMessage(null)).toBe(
      "Die Warteschlange konnte nicht geändert werden (unbekannter Fehler). Der Eintrag steht unverändert weiter in der Liste. Lade die Seite neu und versuche es erneut.",
    );
  });
});

describe("replayChained", () => {
  /**
   * Ein Testkommando mit der beim Einreihen gespeicherten Version. Die
   * Wiedergabe kennt sie nicht -- sie reicht dem Kopf `null` und ueberlaesst
   * ihm die Wahl; genau das bildet der Sender unten ab.
   */
  interface Stored {
    readonly name: string;
    readonly storedVersion: number;
  }

  /**
   * Sender wie in der Flaeche: Kopf sendet seine gespeicherte Version,
   * Nachfolger die verkettete. `serverVersion` ist der Stand, auf dem der
   * Server steht; passt die gesendete Version nicht, ist das ein Konflikt.
   */
  function sender(serverVersion: number, calls: Array<{ readonly name: string; readonly expectedVersion: number }>) {
    let current = serverVersion;
    return async (command: Stored, chainedVersion: number | null): Promise<ReplayOutcome> => {
      const expectedVersion = chainedVersion ?? command.storedVersion;
      calls.push({ name: command.name, expectedVersion });
      // Ein Versionskonflikt ist ein Serverurteil: nicht angenommen.
      if (expectedVersion !== current) return { successful: false, accepted: false };
      current += 1;
      return { successful: true, version: current };
    };
  }

  it("laesst den Kopf seine gespeicherte Version senden und kettet die Nachfolger aus den Antworten", async () => {
    const calls: Array<{ readonly name: string; readonly expectedVersion: number }> = [];
    const result = await replayChained(
      [{ name: "a", storedVersion: 10 }, { name: "b", storedVersion: 10 }, { name: "c", storedVersion: 10 }],
      sender(10, calls),
    );
    expect(calls).toEqual([
      { name: "a", expectedVersion: 10 },
      { name: "b", expectedVersion: 11 },
      { name: "c", expectedVersion: 12 },
    ]);
    expect(result).toEqual({ sentCount: 3, acceptedCount: 3 });
  });

  /**
   * Runde 8, Befund A: Hat sich der Server waehrend der Offline-Zeit
   * unabhaengig bewegt -- ein anderes Geraet hat gescort, eine Korrektur
   * wurde gebucht --, MUSS der Kopf konfligieren. Vorher bekam er die frisch
   * geladene Serverversion untergeschoben und ging deshalb immer durch: die
   * veraltete Aufnahme wurde auf einen fremden Zustand gesetzt, statt die
   * Person entscheiden zu lassen (ADR 0008, AGENTS.md §12).
   */
  it("laesst den Kopf konfligieren, wenn der Server sich unabhaengig bewegt hat, und stoppt die Kette", async () => {
    const calls: Array<{ readonly name: string; readonly expectedVersion: number }> = [];
    const result = await replayChained(
      [{ name: "a", storedVersion: 10 }, { name: "b", storedVersion: 10 }],
      sender(12, calls),
    );
    expect(calls).toEqual([{ name: "a", expectedVersion: 10 }]);
    expect(result).toEqual({ sentCount: 0, acceptedCount: 0 });
  });

  /**
   * Nach dem Verwerfen des konfliktbehafteten Kopfes rueckt sein Nachfolger
   * nach und sendet ebenfalls SEINE gespeicherte Version -- nicht die des
   * verworfenen Vorgaengers und keine hochgerechnete. Steht der Server noch
   * dort, geht er durch.
   */
  it("laesst den nachrueckenden Kopf seine eigene gespeicherte Version senden", async () => {
    const calls: Array<{ readonly name: string; readonly expectedVersion: number }> = [];
    const result = await replayChained([{ name: "b", storedVersion: 9 }], sender(9, calls));
    expect(calls).toEqual([{ name: "b", expectedVersion: 9 }]);
    expect(result).toEqual({ sentCount: 1, acceptedCount: 1 });
  });

  /**
   * PR-Agent-Befund F2 ("Stale Versions"): urspruenglich standen drei
   * Kommandos in der Warteschlange, "b" wurde verworfen, bevor die Wiedergabe
   * lief -- sie sieht nur noch "a" und "c". "c" darf nicht die fuer drei
   * Kommandos vorausberechnete, nun unerreichbare Version senden, sondern
   * kettet aus der tatsaechlichen Antwort auf "a".
   */
  it("baut die Kette nach dem Verwerfen eines mittleren Kommandos aus den verbleibenden auf, kein Konflikt", async () => {
    const calls: Array<{ readonly name: string; readonly expectedVersion: number }> = [];
    const result = await replayChained(
      [{ name: "a", storedVersion: 5 }, { name: "c", storedVersion: 5 }],
      sender(5, calls),
    );
    expect(calls).toEqual([
      { name: "a", expectedVersion: 5 },
      { name: "c", expectedVersion: 6 },
    ]);
    expect(result).toEqual({ sentCount: 2, acceptedCount: 2 });
  });

  it("bricht beim ersten Fehlschlag ab und zaehlt ihn nicht mit", async () => {
    const result = await replayChained(["a", "b", "c"], async (command) =>
      command === "b" ? { successful: false, accepted: false } : { successful: true, version: 2 },
    );
    expect(result).toEqual({ sentCount: 1, acceptedCount: 1 });
  });

  /**
   * Runde 8, Befund B: Der Server hat angenommen, nur das lokale Aufraeumen
   * scheiterte. Die Kette bricht weiterhin ab -- die Reihenfolge ist
   * verbindlich --, aber der Serverstand HAT sich bewegt: `acceptedCount`
   * zaehlt das Kommando mit, damit die Flaeche nachlaedt. Vorher blieb der
   * einzige Zaehler auf 0, der Refresh entfiel, und die naechste Aufnahme lief
   * gegen einen veralteten Cache und eine veraltete Version.
   */
  it("zaehlt eine Serverannahme auch dann, wenn das lokale Aufraeumen scheiterte", async () => {
    const result = await replayChained(["a", "b"], async (command) =>
      command === "a" ? { successful: false, accepted: true } : { successful: true, version: 2 },
    );
    expect(result).toEqual({ sentCount: 0, acceptedCount: 1 });
  });

  it("zaehlt eine Annahme nach durchgegangenen Kommandos zusaetzlich", async () => {
    const result = await replayChained(["a", "b", "c"], async (command) =>
      command === "b" ? { successful: false, accepted: true } : { successful: true, version: 2 },
    );
    expect(result).toEqual({ sentCount: 1, acceptedCount: 2 });
  });

  it("sendet nichts und meldet null Kommandos bei einer leeren Kette", async () => {
    const send = vi.fn();
    const result = await replayChained([], send);
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ sentCount: 0, acceptedCount: 0 });
  });
});

describe("withCurrentExpectedVersion", () => {
  /**
   * PR-Agent-Befund F2 / Gesamtaudit C11 ("Stale Versions"): ein
   * NACHFOLGER in der Kette traegt eine eingefrorene `expectedVersion` in
   * seiner gespeicherten Nutzlast. Sie wird durch die verkettete Version aus
   * der Antwort auf den Vorgaenger ersetzt, alle uebrigen Felder bleiben
   * unveraendert. Der Kopf laeuft nicht durch diese Funktion -- er sendet
   * seine gespeicherte Version (Runde 8, Befund A).
   */
  it("ersetzt eine eingefrorene Version durch die aktuelle und laesst uebrige Felder unveraendert", () => {
    const stale = { commandId: "c1", expectedVersion: 3, points: 60 };
    expect(withCurrentExpectedVersion(stale, 42)).toEqual({ commandId: "c1", expectedVersion: 42, points: 60 });
  });

  it("ergaenzt die Version, auch wenn die Nutzlast keine trug", () => {
    expect(withCurrentExpectedVersion({ commandId: "c1" }, 7)).toEqual({ commandId: "c1", expectedVersion: 7 });
  });
});

describe("queuedCommandNotice", () => {
  it("bietet bei Konflikt und Ablehnung das Verwerfen an", () => {
    expect(queuedCommandNotice(command({ status: "CONFLICT", error: "Serverzustand geändert." }), { online: true }))
      .toEqual({ text: "60 Punkte · Serverzustand geändert.", action: "DISCARD" });
    expect(queuedCommandNotice(command({ status: "REJECTED", error: "Nicht erlaubt." }), { online: true }))
      .toEqual({ text: "60 Punkte · Vom Server abgelehnt: Nicht erlaubt.", action: "DISCARD" });
  });

  it("unterscheidet wartende Kommandos nach Verbindung", () => {
    expect(queuedCommandNotice(command(), { online: true }).text).toBe("60 Punkte · Wiederholung läuft");
    expect(queuedCommandNotice(command(), { online: false }).text).toBe("60 Punkte · Offline");
    expect(queuedCommandNotice(command(), { online: false }).action).toBe("RETRY");
    expect(queuedCommandNotice(command(), { online: true, pendingOnline: "wartet auf Übertragung" }).text)
      .toBe("60 Punkte · wartet auf Übertragung");
  });

  /**
   * Runde 7: Ein wartender Eintrag, den der Server angenommen hat, ist der
   * einzige, der verworfen werden darf -- und die Meldung sagt, dass dabei
   * nichts verloren geht. Vorher bot das Band das Verwerfen fuer jeden
   * wartenden Eintrag an, sobald irgendein Schreibfehler des Scopes anstand.
   */
  it("benennt einen angenommenen, nur lokal haengenden Eintrag und bietet das Verwerfen an", () => {
    expect(queuedCommandNotice(command(), { online: true, acceptedButStuck: true })).toEqual({
      text: "60 Punkte · Vom Server angenommen; nur lokal nicht entfernt. Verwerfen räumt den Eintrag hier auf, am Serverstand ändert sich nichts.",
      action: "DISCARD",
    });
  });

  it("laesst einen abgelehnten Eintrag unveraendert, auch wenn daneben etwas haengt", () => {
    expect(queuedCommandNotice(command({ status: "REJECTED", error: "Nicht erlaubt." }), { online: true, acceptedButStuck: false }).action)
      .toBe("DISCARD");
  });
});

describe("replayAnnouncement", () => {
  it("meldet nichts Uebertragenes im Plural", () => {
    expect(replayAnnouncement({ sentCount: 0, acceptedCount: 0 })).toBe("0 Befehle übertragen.");
  });

  it("meldet einen einzelnen Befehl im Singular", () => {
    expect(replayAnnouncement({ sentCount: 1, acceptedCount: 1 })).toBe("1 Befehl übertragen.");
  });

  /**
   * Der Befund: der Server hat angenommen, nur das lokale Aufraeumen
   * scheiterte. `sentCount` bleibt dann auf 0 und die Meldung behauptete, es
   * sei nichts uebertragen worden -- waehrend die Zuweisung laengst gebucht
   * war. Gezaehlt wird, was der Server angenommen hat.
   */
  it("zaehlt eine angenommene Zuweisung auch ohne lokales Aufraeumen", () => {
    expect(replayAnnouncement({ sentCount: 0, acceptedCount: 1 })).toBe("1 Befehl übertragen.");
  });

  it("meldet mehrere Befehle im Plural", () => {
    expect(replayAnnouncement({ sentCount: 2, acceptedCount: 3 })).toBe("3 Befehle übertragen.");
  });
});
