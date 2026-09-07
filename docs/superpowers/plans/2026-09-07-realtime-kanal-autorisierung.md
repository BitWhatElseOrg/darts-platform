# Realtime: Räume auf der public_id und Kanal-Autorisierung — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Realtime-Raum wird über die öffentliche ID adressiert, und wer beitritt, muss dafür berechtigt sein — als Publikum eines freigegebenen Turniers, als Mitglied der Organisation oder mit einem Anzeige-Schlüssel.

**Architecture:** `tournament:subscribe` nimmt die `public_id` statt der internen ID. Der Server löst sie auf, ermittelt Mitgliedschaft aus der Sitzung im Handshake und den Zustand eines mitgeschickten Anzeige-Schlüssels, und entscheidet über eine reine Funktion. Das Outbox-Relay bildet beim Verteilen die interne ID über einen prozesslokalen Cache auf die `public_id` ab. Begegnungen werden gleich behandelt und verlieren dadurch ihr Polling.

**Tech Stack:** TypeScript strict, Socket.IO, `@socket.io/redis-adapter`, NestJS, Better Auth, Drizzle ORM, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-07-oeffentliche-turnier-ids-design.md`](../specs/2026-09-07-oeffentliche-turnier-ids-design.md)

**Voraussetzung:** [Plan 1](./2026-09-07-oeffentliche-turnier-ids.md) und [Plan 2](./2026-09-07-anzeige-schluessel.md) sind umgesetzt und gemerged.

## Global Constraints

- `strict: true`; kein `any`, kein `as any`. `unknown` statt `any`, discriminated unions, exhaustive `switch`.
- Kommentare und Oberflächentexte auf Deutsch (Schweizer Rechtschreibung, kein ß), Code-Bezeichner auf Englisch.
- Realtime-Ereignisse werden erst nach erfolgreichem Commit verteilt (AGENTS.md §4) — daran ändert dieser Plan nichts.
- `event-routing.ts` bleibt infrastrukturfrei: keine Datenbank, kein Socket.IO. Was eine Abfrage braucht, gehört in `publish-outbox.ts`.
- Vor Abschluss: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`.

## Eine Korrektur an der Spec

Die Spec sieht ein neues Ereignis `tournament:denied` für abgelehnte Abonnements vor. Das ist überflüssig: `subscription-limit.ts` sendet für abgewiesene Beitritte bereits `subscription:rejected` mit einem `reason` — heute `SUBSCRIPTION_LIMIT_REACHED`. Eine Ablehnung aus fehlender Berechtigung ist derselbe Vorgang mit einem anderen Grund und gehört auf denselben Kanal. Zwei Ereignisse für „du bist nicht drin" hiessen zwei Zustände in jedem Client.

Neue Gründe: `SUBSCRIPTION_FORBIDDEN` (Turnier privat, kein Nachweis) und `SUBSCRIPTION_UNKNOWN_ROOM` (unbekannte `public_id`). Beide werden vom Client gleich behandelt; die Unterscheidung dient der Fehlersuche in den Logs, nicht der Anzeige — nach aussen bleibt „nicht gefunden" und „nicht erlaubt" ununterscheidbar.

---

### Task 1: Die Entscheidung als reine Funktion

**Files:**
- Create: `packages/domain/src/subscription-access.ts`
- Create: `packages/domain/src/subscription-access.spec.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `TournamentVisibility` (Plan 1), `DisplayKeyState` (Plan 2).
- Produces: `decideSubscription(input: SubscriptionInput): SubscriptionDecision` mit
  `SubscriptionInput = { readonly target: "known" | "unknown"; readonly visibility: TournamentVisibility; readonly membership: "member" | "none"; readonly displayKey: DisplayKeyState | "absent" }`
  und `SubscriptionDecision = { readonly kind: "allow" } | { readonly kind: "deny"; readonly reason: "SUBSCRIPTION_FORBIDDEN" | "SUBSCRIPTION_UNKNOWN_ROOM" }`.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Create `packages/domain/src/subscription-access.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { decideSubscription } from "./subscription-access";

const base = {
  target: "known",
  visibility: "PRIVATE",
  membership: "none",
  displayKey: "absent",
} as const;

describe("decideSubscription", () => {
  it("laesst jeden in ein oeffentliches Turnier", () => {
    expect(decideSubscription({ ...base, visibility: "PUBLIC" })).toEqual({ kind: "allow" });
  });

  it("laesst ein Mitglied in ein privates Turnier", () => {
    expect(decideSubscription({ ...base, membership: "member" })).toEqual({ kind: "allow" });
  });

  it("laesst einen gueltigen Anzeige-Schluessel in ein privates Turnier", () => {
    expect(decideSubscription({ ...base, displayKey: "valid" })).toEqual({ kind: "allow" });
  });

  it("weist ein privates Turnier ohne jeden Nachweis ab", () => {
    expect(decideSubscription(base)).toEqual({
      kind: "deny",
      reason: "SUBSCRIPTION_FORBIDDEN",
    });
  });

  it("weist einen abgelaufenen Schluessel ab", () => {
    expect(decideSubscription({ ...base, displayKey: "expired" })).toEqual({
      kind: "deny",
      reason: "SUBSCRIPTION_FORBIDDEN",
    });
  });

  it("weist einen widerrufenen Schluessel ab", () => {
    expect(decideSubscription({ ...base, displayKey: "revoked" })).toEqual({
      kind: "deny",
      reason: "SUBSCRIPTION_FORBIDDEN",
    });
  });

  it("nennt eine unbekannte Adresse unbekannt, auch wenn sie oeffentlich waere", () => {
    expect(
      decideSubscription({ ...base, target: "unknown", visibility: "PUBLIC" }),
    ).toEqual({ kind: "deny", reason: "SUBSCRIPTION_UNKNOWN_ROOM" });
  });

  it("laesst ein Mitglied auch mit abgelaufenem Schluessel hinein", () => {
    // Die Nachweise sind alternativ, nicht kumulativ: ein totes Tablet-Token
    // darf einer angemeldeten Turnierleitung nicht den Kanal verschliessen.
    expect(
      decideSubscription({ ...base, membership: "member", displayKey: "expired" }),
    ).toEqual({ kind: "allow" });
  });
});
```

- [ ] **Step 2: Test laufen lassen und scheitern sehen**

Run: `cd packages/domain && npx vitest run src/subscription-access.spec.ts`
Erwartet: FAIL — Modul nicht gefunden.

- [ ] **Step 3: Die Funktion schreiben**

Create `packages/domain/src/subscription-access.ts`:

```ts
import type { DisplayKeyState } from "./display-key";
import type { TournamentVisibility } from "./tournament-visibility";

export interface SubscriptionInput {
  /** Ob die oeffentliche Adresse ueberhaupt zu etwas gehoert. */
  readonly target: "known" | "unknown";
  readonly visibility: TournamentVisibility;
  readonly membership: "member" | "none";
  readonly displayKey: DisplayKeyState | "absent";
}

export type SubscriptionDecision =
  | { readonly kind: "allow" }
  | {
      readonly kind: "deny";
      readonly reason: "SUBSCRIPTION_FORBIDDEN" | "SUBSCRIPTION_UNKNOWN_ROOM";
    };

/**
 * Wer darf welchen Raum hoeren. Drei Eintrittskarten, alternativ zueinander:
 * das Turnier ist freigegeben, der Horchende ist Mitglied der Organisation,
 * oder er bringt einen gueltigen Anzeige-Schluessel mit.
 *
 * Ohne Datenbank und ohne Socket.IO — dieselbe Trennung wie in
 * `event-routing.ts`. Der Aufrufer beschafft die vier Angaben, diese Funktion
 * entscheidet, und die Entscheidung ist damit ohne Infrastruktur pruefbar.
 */
export function decideSubscription(input: SubscriptionInput): SubscriptionDecision {
  if (input.target === "unknown") {
    return { kind: "deny", reason: "SUBSCRIPTION_UNKNOWN_ROOM" };
  }
  if (input.visibility === "PUBLIC") return { kind: "allow" };
  if (input.membership === "member") return { kind: "allow" };
  if (input.displayKey === "valid") return { kind: "allow" };
  return { kind: "deny", reason: "SUBSCRIPTION_FORBIDDEN" };
}
```

In `packages/domain/src/index.ts` exportieren.

- [ ] **Step 4: Test laufen lassen und bestätigen**

Run: `cd packages/domain && npx vitest run src/subscription-access.spec.ts`
Erwartet: PASS, acht Fälle.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src
git commit -m "feat(domain): Entscheidung ueber Realtime-Abonnements"
```

---

### Task 2: Räume tragen die public_id

**Files:**
- Modify: `apps/api/src/realtime/event-routing.ts`
- Modify: `apps/api/src/realtime/event-routing.spec.ts`
- Modify: `apps/api/src/realtime/publish-outbox.ts`
- Modify: `apps/api/src/realtime/publish-outbox.spec.ts`

**Interfaces:**
- Consumes: `tournaments.publicId` (Plan 1), `encounters.publicId` (bestand bereits).
- Produces: `RealtimeScope` trägt `publicId` statt `id`; `toBroadcast` bildet `tournament:<publicId>` und `encounter:<publicId>`; `resolveScope` schlägt die `publicId` nach und cacht sie.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

In `apps/api/src/realtime/event-routing.spec.ts`:

```ts
  it("benennt den Raum nach der oeffentlichen ID, nicht nach der internen", () => {
    const broadcast = toBroadcast(
      { id: "e1", eventType: "MATCH_FINISHED", occurredAt: new Date(0) },
      { kind: "tournament", publicId: "6f1f1f6a-0000-4000-8000-000000000001" },
    );

    expect(broadcast?.room).toBe("tournament:6f1f1f6a-0000-4000-8000-000000000001");
    expect(broadcast?.payload.tournamentId).toBe("6f1f1f6a-0000-4000-8000-000000000001");
  });
```

Der zweite Teil der Zusicherung ist der wichtige: die Nutzlast trug bisher `tournamentId` mit der internen ID und hätte sie sonst weiterhin an jedes Publikum verteilt. Das Feld heisst künftig `publicId`; passe die Zusicherung und den Client entsprechend an.

- [ ] **Step 2: Test laufen lassen und scheitern sehen**

Run: `cd apps/api && npx vitest run src/realtime/event-routing.spec.ts`
Erwartet: FAIL — `RealtimeScope` kennt kein `publicId`.

- [ ] **Step 3: `event-routing.ts` umstellen**

`RealtimeScope` wird zu:

```ts
export type RealtimeScope =
  | { readonly kind: "tournament"; readonly publicId: string }
  | { readonly kind: "encounter"; readonly publicId: string };
```

In `toBroadcast` die Raumnamen und die Nutzlastfelder entsprechend umbenennen (`tournamentId` → `publicId`, `encounterId` → `publicId`). Der Kommentar über `parseSubscriptionId` bleibt gültig — nur eine UUID darf zu einem Raumnamen werden; das gilt für die öffentliche ID genauso.

- [ ] **Step 4: `resolveScope` die Abbildung beibringen**

In `apps/api/src/realtime/publish-outbox.ts`:

```ts
/**
 * Die Zuordnung interne ID → oeffentliche ID aendert sich nie: beide Werte
 * stehen bei der Anlage fest und werden nie ueberschrieben. Ein prozesslokaler
 * Cache spart damit eine Abfrage je Ereignis, ohne veralten zu koennen.
 *
 * Die Groesse ist unbegrenzt, und das ist Absicht: der Cache waechst mit der
 * Zahl der Turniere und Begegnungen, die waehrend einer Prozesslaufzeit
 * Ereignisse erzeugen — das sind Dutzende, nicht Millionen.
 */
const publicIdCache = new Map<string, string>();

async function publicIdOf(
  executor: OutboxExecutor,
  kind: "tournament" | "encounter",
  internalId: string,
): Promise<string | null> {
  const cacheKey = `${kind}:${internalId}`;
  const cached = publicIdCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const [row] =
    kind === "tournament"
      ? await executor
          .select({ publicId: tournaments.publicId })
          .from(tournaments)
          .where(eq(tournaments.id, internalId))
          .limit(1)
      : await executor
          .select({ publicId: encounters.publicId })
          .from(encounters)
          .where(eq(encounters.id, internalId))
          .limit(1);

  if (row === undefined) return null;
  publicIdCache.set(cacheKey, row.publicId);
  return row.publicId;
}
```

`resolveScope` gibt danach `{ kind: "tournament", publicId }` zurück statt `{ kind: "tournament", id: event.aggregateId }`; liefert `publicIdOf` `null`, gibt `resolveScope` ebenfalls `null` zurück — dasselbe Verhalten wie bei einem Match ohne Bezug, das der bestehende Kommentar in der Datei bereits beschreibt.

- [ ] **Step 5: Die Cache-Zusicherung ergänzen**

In `apps/api/src/realtime/publish-outbox.spec.ts` einen Fall, der zweimal dasselbe Turnier auflöst und zählt, wie oft der Executor befragt wurde:

```ts
  it("fragt die oeffentliche ID nur einmal je Turnier ab", async () => {
    let queries = 0;
    const executor = countingExecutor(() => { queries += 1; });

    await resolveScope(executor, { organizationId, aggregateType: "Tournament", aggregateId });
    await resolveScope(executor, { organizationId, aggregateType: "Tournament", aggregateId });

    expect(queries).toBe(1);
  });
```

`countingExecutor` ist im bestehenden Testdoppel dieser Datei zu ergänzen — dem dortigen Aufbau folgen, keinen zweiten Stil einführen.

- [ ] **Step 6: Tests laufen lassen und bestätigen**

Run: `cd apps/api && npx dotenv -e .env.test -- npx vitest run src/realtime`
Erwartet: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/realtime
git commit -m "feat(realtime): Raeume tragen die oeffentliche ID"
```

---

### Task 3: Autorisierung beim subscribe

**Files:**
- Modify: `apps/api/src/realtime/realtime.service.ts`
- Modify: `apps/api/src/realtime/subscription-limit.ts`
- Create: `apps/api/src/realtime/subscription-authorization.ts`
- Create: `apps/api/src/realtime/subscription-authorization.integration.spec.ts`
- Modify: `apps/api/src/realtime/realtime.module.ts`

**Interfaces:**
- Consumes: `decideSubscription` aus Task 1; `AuthService.getSession(headers)`; `OrganizationsRepository.getActiveMembership`; `DisplayKeysService.resolve` (Plan 2).
- Produces: `SubscriptionAuthorization.authorizeTournament(input: { readonly publicId: string; readonly headers: IncomingHttpHeaders; readonly displayKeySecret: string | undefined }): Promise<SubscriptionDecision>` und die Schwester `authorizeEncounter`.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Create `apps/api/src/realtime/subscription-authorization.integration.spec.ts` mit vier Fällen, die den Weg von aussen nach innen prüfen: öffentliches Turnier ohne Cookie → `allow`; privates Turnier ohne Cookie → `deny/SUBSCRIPTION_FORBIDDEN`; privates Turnier mit dem Cookie eines Mitglieds → `allow`; privates Turnier mit gültigem Anzeige-Schlüssel → `allow`. Die Sitzung wird über den echten `AuthService` aufgelöst; das Cookie stammt aus einer echten Anmeldung im Test, wie es die Integrationstests unter `apps/api/src/auth` bereits vormachen.

- [ ] **Step 2: Test laufen lassen und scheitern sehen**

Run: `cd apps/api && npx dotenv -e .env.test -- npx vitest run src/realtime/subscription-authorization.integration.spec.ts`
Erwartet: FAIL — Modul nicht gefunden.

- [ ] **Step 3: Die Zusammenführung schreiben**

Create `apps/api/src/realtime/subscription-authorization.ts`. Sie beschafft die vier Angaben und übergibt sie an `decideSubscription`:

```ts
/**
 * Beschafft, was `decideSubscription` braucht, und entscheidet nichts selbst.
 * Die Trennung ist Absicht: die Regel ist ohne Datenbank pruefbar, das
 * Beschaffen ohne Regel austauschbar.
 *
 * Die Sitzung kommt aus dem Cookie des Handshakes — der Socket verbindet mit
 * `withCredentials`, das Cookie liegt also an. `AuthService.getSession` nimmt
 * rohe Node-Header entgegen, und genau die liefert `socket.handshake.headers`.
 */
@Injectable()
export class SubscriptionAuthorization {
  public async authorizeTournament(input: {
    readonly publicId: string;
    readonly headers: IncomingHttpHeaders;
    readonly displayKeySecret: string | undefined;
  }): Promise<SubscriptionDecision> {
    const tournament = await this.tournaments.getAccessFactsByPublicId(input.publicId);
    if (tournament === null) {
      return decideSubscription({
        target: "unknown",
        visibility: "PRIVATE",
        membership: "none",
        displayKey: "absent",
      });
    }

    // Nur beschaffen, was die Entscheidung noch braucht: ein oeffentliches
    // Turnier kostet damit weder eine Sitzungsaufloesung noch einen
    // Schluesselnachschlag.
    if (tournament.visibility === "PUBLIC") {
      return decideSubscription({
        target: "known",
        visibility: "PUBLIC",
        membership: "none",
        displayKey: "absent",
      });
    }

    const session = await this.auth.getSession(input.headers);
    const membership =
      session === null
        ? "none"
        : await this.organizations
            .getActiveMembership({
              organizationId: tournament.organizationId,
              userId: session.user.id,
            })
            .then((row) => (row === null ? "none" : "member"));

    const displayKey =
      input.displayKeySecret === undefined
        ? "absent"
        : await this.displayKeys.stateOf(tournament.id, input.displayKeySecret);

    return decideSubscription({
      target: "known",
      visibility: tournament.visibility,
      membership,
      displayKey,
    });
  }
}
```

`TournamentsRepository.getAccessFactsByPublicId` und `DisplayKeysService.stateOf` stammen beide aus Plan 2 und sind hier nur zu verwenden — nicht neu zu schreiben. Falls sie fehlen, wurde Plan 2 unvollständig umgesetzt; das ist zu beheben, bevor dieser Task weitergeht.

- [ ] **Step 4: Den Ablehnungsgrund erweitern**

In `apps/api/src/realtime/subscription-limit.ts` den Typ des Grundes von einem Literal auf eine Vereinigung heben:

```ts
export type SubscriptionRejection =
  | "SUBSCRIPTION_LIMIT_REACHED"
  | "SUBSCRIPTION_FORBIDDEN"
  | "SUBSCRIPTION_UNKNOWN_ROOM";
```

und eine Funktion `rejectSubscription(socket, room, reason: SubscriptionRejection)` ergänzen, die `subscription:rejected` sendet. `joinSubscription` benutzt sie für den Grenzfall — damit gibt es genau eine Stelle, die dieses Ereignis sendet.

- [ ] **Step 5: `RealtimeService.register` umstellen**

```ts
  private register(socket: Socket): void {
    socket.on("tournament:subscribe", (payload: SubscribePayload) => {
      void this.subscribeTournament(socket, payload);
    });
    // … encounter analog
  }

  private async subscribeTournament(socket: Socket, payload: SubscribePayload): Promise<void> {
    const publicId = parseSubscriptionId(payload?.publicId);
    if (publicId === null) {
      rejectSubscription(socket, "tournament:?", "SUBSCRIPTION_UNKNOWN_ROOM");
      return;
    }
    const decision = await this.authorization.authorizeTournament({
      publicId,
      headers: socket.handshake.headers,
      displayKeySecret:
        typeof payload?.displayKey === "string" ? payload.displayKey : undefined,
    });
    const room = `tournament:${publicId}`;
    if (decision.kind === "deny") {
      // Auf Warnstufe, mit dem Grund: in den Logs unterscheidbar, nach aussen
      // nicht — der Client bekommt beide Gruende gleich serviert.
      this.logger.warn({
        event: "realtime.subscription_denied",
        room,
        reason: decision.reason,
      });
      rejectSubscription(socket, room, decision.reason);
      return;
    }
    this.subscribe(socket, room);
  }
```

`SubscribePayload` trägt künftig `publicId` und `displayKey` statt `tournamentId`/`encounterId`.

- [ ] **Step 6: Tests laufen lassen und bestätigen**

Run: `cd apps/api && npx dotenv -e .env.test -- npx vitest run src/realtime`
Erwartet: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/realtime
git commit -m "feat(realtime): Abonnements werden autorisiert"
```

---

### Task 4: Die Weboberfläche kommt zurück in die Räume

**Files:**
- Modify: `apps/web/src/lib/realtime.ts`
- Modify: `apps/web/src/components/live/live-tournament.tsx`
- Modify: `apps/web/src/components/live/live-encounter.tsx`
- Modify: `apps/web/src/components/tournament/command-centre.tsx`
- Modify: `apps/web/src/components/league/use-encounter-command.ts`
- Modify: `apps/web/tests/foundation.spec.ts`

**Interfaces:**
- Consumes: `tournament:subscribe { publicId, displayKey? }` aus Task 3.
- Produces: `connectTournamentRealtime({ publicId, displayKey, … })`, `connectEncounterRealtime({ publicId, … })`.

- [ ] **Step 1: Den Client umstellen**

In `apps/web/src/lib/realtime.ts` beide Verbindungsfunktionen auf `publicId` heben und `connectTournamentRealtime` um `displayKey?: string | null` erweitern; der Wert wandert in die Nutzlast von `tournament:subscribe`. Ergänze einen Zuhörer auf `subscription:rejected`, der `onConnection("abgewiesen")` meldet.

`RealtimeConnection` wird dafür zu `"verbunden" | "verbindet" | "getrennt" | "abgewiesen"`. Jede Stelle, die diesen Typ anzeigt, muss den vierten Fall behandeln — der `switch` ist erschöpfend zu halten. Ein abgewiesener Kanal ist etwas anderes als ein getrennter: „getrennt" lädt zum Warten ein, „abgewiesen" nicht.

- [ ] **Step 2: Die öffentliche Turnieransicht wieder anschliessen**

In `live-tournament.tsx` den in Plan 1 entfernten Realtime-Aufruf wiederherstellen, jetzt mit `publicId` und dem Anzeige-Schlüssel aus Plan 2. `refetchInterval` geht zurück auf `connection === "verbunden" ? false : 5_000`, und den Kommentar aus Plan 1 („der Raum laeuft noch auf der internen ID") entfernen — er ist ab hier falsch.

- [ ] **Step 3: Der Begegnungsansicht das Polling nehmen**

In `live-encounter.tsx` `connectEncounterRealtime({ publicId, … })` einhängen und `refetchInterval: 15_000` durch dieselbe Bedingung ersetzen. Den Kommentar „Die öffentliche Ansicht kennt nur die `publicId`. Der Socket-Raum heisst …" ersetzen: er beschreibt das Problem, das dieser Task löst.

Das ist der sichtbarste Gewinn des ganzen Programms — bis hierher aktualisierte sich ein Ligaspielabend für das Publikum alle 15 Sekunden.

- [ ] **Step 4: Kommandozentrale und Ligapanel**

`command-centre.tsx` und `use-encounter-command.ts` abonnieren als angemeldete Ansichten. Sie geben die `publicId` weiter, die aus dem Dashboard beziehungsweise der Begegnung stammt — die Mitgliedschaft weist das Cookie nach, ein Anzeige-Schlüssel ist hier nicht nötig.

- [ ] **Step 5: Den E2E-Fall ergänzen**

In `apps/web/tests/foundation.spec.ts`: ein öffentliches Turnier in einem anonymen Kontext öffnen, in einem zweiten (angemeldeten) Kontext ein Match beenden und erwarten, dass die anonyme Ansicht das Ergebnis **ohne Neuladen und ohne auf ein Intervall zu warten** zeigt. Die Zusicherung mit einem knappen Zeitfenster versehen (`timeout: 5_000`), sonst bewiese sie nur, dass irgendwann nachgeladen wird — und genau das war der Zustand vorher.

- [ ] **Step 6: Die volle Kette**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
```

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): Live-Ansichten abonnieren ueber die oeffentliche ID"
```

---

### Task 5: Dokumentation und Aufräumen

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `apps/api/src/realtime/subscription-limit.ts` (Kommentar)
- Modify: `docs/adr/` (neuer ADR)

- [ ] **Step 1: Den überholten Kommentar korrigieren**

In `subscription-limit.ts` steht heute: „Die Kanal-Autorisierung selbst (wer darf welchen Raum hoeren) ist damit nicht beantwortet; sie steht als eigenes Vorhaben aus." Das Vorhaben ist erledigt — der Satz wird durch einen Verweis auf `subscription-authorization.ts` ersetzt. Ein Kommentar, der eine erledigte Lücke behauptet, schickt den nächsten Leser auf eine falsche Fährte.

- [ ] **Step 2: ARCHITECTURE.md**

Einen Abschnitt „Öffentliche Adressierung und Kanal-Autorisierung" schreiben, der alle drei Pläne zusammenfasst: `public_id` und Sichtbarkeit, Anzeige-Schlüssel, Räume und Entscheidung. Erst hier, nicht dreimal nacheinander.

- [ ] **Step 3: ADR schreiben**

`docs/adr/00NN-oeffentliche-turnier-adressen.md` mit dem Entscheid und den beiden verworfenen Alternativen (signiertes Ticket im Handshake; drei Sichtbarkeitsstufen mit Verzeichnis) samt Begründung. Die Nummer aus dem höchsten vorhandenen ADR ableiten.

- [ ] **Step 4: Commit**

```bash
git add ARCHITECTURE.md docs/adr apps/api/src/realtime/subscription-limit.ts
git commit -m "docs: oeffentliche Adressierung und Kanal-Autorisierung"
```

---

## Nach diesem Plan

- Der Übergangsweg aus Plan 1 (`/address` und `/live/legacy/[id]`) kann entfernt werden, sobald seine Frist abgelaufen ist — eigener, kleiner PR.
- Damit sind die Audit-Befunde I-1b und I-2 geschlossen. Offen aus Tier 3 bleiben I-7 (zusammengesetzte Fremdschlüssel), C10 (Snapshot und `payload_version`), die Design-System-Konsolidierung und die CSP-Nonce.
