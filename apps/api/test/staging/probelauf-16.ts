/* eslint-disable @typescript-eslint/no-explicit-any */
// Betriebsprobe (kein Spec): ein ganzes 16er-Turnier gegen Staging durchspielen.
// 4 Gruppen a 4, 2 qualifizieren, KO mit 8, 4 Boards, Best of 3 Legs 501 Double Out.
// Vier "Scorer-Geraete" spielen parallel Wurf fuer Wurf (Busts, Checkouts, Undo,
// doppelt gesendete commandIds, veraltete expectedVersion), die Turnierleitung weist
// Boards zu, ein Zuschauer-Socket und die oeffentliche Live-Ansicht laufen mit.
// Eingebaute Stoerungen: Matchabbruch auf Board 2 (A) und Rueckzug in der
// Gruppenphase (B). Ergebnis: <SIM_OUT>.log, .status.json, .summary.json.
// Aufruf aus apps/api:
//   SIM_OUT=/tmp/probelauf npx dotenv -e ../../.env.staging -- npx tsx test/staging/probelauf-16.ts
// Wiederaufnahme eines angelegten Turniers: SIM_RESUME=<status.json> dazu setzen.
// `any` ist hier bewusst: das Skript liest ungetypte Antworten der Staging-API
// und prueft sie gegen die Erwartung; ein Schema-Import wuerde genau die
// Vertragsabweichungen verdecken, die diese Probe sichtbar machen soll.
// Protokoll: docs/testing/protokolle/2026-09-25-probelauf-16-spieler.md
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { io, type Socket } from "socket.io-client";
import { previewVisitOutcome } from "@darts-platform/scoring-engine";
import { readStagingConfig, signIn, type StagingSession } from "/home/sut/projects/darts-platform/apps/api/test/staging/staging-client.js";

const OUT = process.env.SIM_OUT ?? "/tmp/sim";
const LOG = `${OUT}.log`;
const STATUS = `${OUT}.status.json`;
const VISIT_DELAY_MS: [number, number] = [900, 1600];
const config = readStagingConfig();
const orgId = process.env.STAGING_ORGANIZATION_ID!;
const startedAt = Date.now();

type Dart = { segment: number; multiplier: 1 | 2 | 3 };
type Finding = { time: string; severity: "niedrig" | "mittel" | "hoch" | "kritisch" | "info"; text: string; detail?: unknown };
const findings: Finding[] = [];
const stats = {
  requests: 0, http5xx: 0, http429: 0, http409: 0, http4xxOther: 0, minRateRemaining: Infinity,
  visits: 0, visitsBust: 0, visitsCheckout: 0, duplicateResends: 0, staleVersionProbes: 0, undos: 0,
  legStarts: 0, assignments: 0, assignConflicts: 0, matchesPlayed: 0, engineMismatches: 0,
  durations: { visit: [] as number[], dashboard: [] as number[], assign: [] as number[], publicLive: [] as number[] },
  realtimeEvents: 0, realtimeByType: {} as Record<string, number>, realtimeLagMs: [] as number[], publicMismatch: 0,
};
function t(): string { return new Date().toISOString().slice(11, 23); }
function log(msg: string): void { const line = `${t()} ${msg}`; console.log(line); appendFileSync(LOG, line + "\n"); }
function finding(severity: Finding["severity"], text: string, detail?: unknown): void {
  findings.push({ time: t(), severity, text, detail }); log(`[BEFUND ${severity}] ${text}${detail === undefined ? "" : " " + JSON.stringify(detail).slice(0, 400)}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
function pct(xs: number[], p: number): number { if (xs.length === 0) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; }

async function call<T = any>(method: string, path: string, body?: unknown, bucket?: keyof typeof stats.durations): Promise<{ status: number; data: T; ms: number }> {
  const t0 = Date.now(); stats.requests++;
  let response: Response;
  try {
    response = await fetch(`${session.baseUrl}${path}`, { method, headers: { "content-type": "application/json", cookie: session.cookie, accept: "application/json", origin: session.origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch (error) { finding("hoch", `Netzwerkfehler ${method} ${path}`, String(error)); throw error; }
  const ms = Date.now() - t0; if (bucket) stats.durations[bucket].push(ms);
  const rem = Number(response.headers.get("x-ratelimit-remaining")); if (Number.isFinite(rem)) stats.minRateRemaining = Math.min(stats.minRateRemaining, rem);
  const text = await response.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (response.status >= 500) { stats.http5xx++; finding("kritisch", `HTTP ${response.status} bei ${method} ${path}`, data); }
  else if (response.status === 429) { stats.http429++; finding("hoch", `HTTP 429 bei ${method} ${path} (Rate-Limit)`, { retryAfter: response.headers.get("retry-after") }); }
  else if (response.status === 409) stats.http409++;
  else if (response.status >= 400) stats.http4xxOther++;
  if (ms > 3000) finding("mittel", `Langsame Antwort ${ms} ms bei ${method} ${path}`);
  return { status: response.status, data, ms };
}

// ---- Spieler und Boards (fiktiv) ----
const NAMES = ["Reto Ammann", "Sandra Bühler", "Marco Ceretti", "Nadine Dubois", "Pascal Egger", "Fabienne Fässler", "Luca Gasser", "Sibylle Huber", "Kevin Imhof", "Corinne Jäger", "Dario Keller", "Melanie Lüthi", "Silvan Meier", "Tanja Näf", "Adrian Oberholzer", "Petra Rüegg"];
const skill = new Map<string, number>(); // Trefferquote T20 (0.08 .. 0.30) und Doppelquote

const session: StagingSession = await signIn(config.baseUrl, config.email, config.password, config.origin);
log(`angemeldet als ${config.email}`);
writeFileSync(LOG, "");
const tag = new Date().toISOString().slice(0, 10);
const resume = process.env.SIM_RESUME ? JSON.parse(readFileSync(process.env.SIM_RESUME, "utf8")) : null;
const playerIds: string[] = resume?.playerIds ?? [];
const boardIds: string[] = resume?.boardIds ?? [];
if (resume) { playerIds.forEach((id, i) => skill.set(id, 0.08 + (i % 8) * 0.03)); log(`Wiederaufnahme von Turnier ${resume.tournamentId}`); }
else {
  for (const [i, name] of NAMES.entries()) {
    const r = await call("POST", `/organizations/${orgId}/players`, { displayName: name, status: "ACTIVE" });
    if (r.status !== 201) throw new Error(`Spieler ${name}: ${r.status} ${JSON.stringify(r.data)}`);
    playerIds.push(r.data.id); skill.set(r.data.id, 0.08 + (i % 8) * 0.03);
  }
  for (const n of [1, 2, 3, 4]) {
    const r = await call("POST", `/organizations/${orgId}/boards`, { name: `Halle Board ${n}` });
    if (r.status !== 201) throw new Error(`Board ${n}: ${r.status}`);
    boardIds.push(r.data.id);
  }
  log(`16 Spieler und 4 Boards angelegt`);
}

// ---- Turnier ----
const preview = await call("POST", `/organizations/${orgId}/tournaments/structure-preview`, { format: "GROUPS_THEN_KNOCKOUT", participantCount: 16, groupCount: 4, qualifyPerGroup: 2, knockoutSize: 8 });
log(`Strukturvorschau: ${JSON.stringify(preview.data)}`);
const created = resume ? { status: 201, data: { id: resume.tournamentId }, ms: 0 } : await call("POST", `/organizations/${orgId}/tournaments`, {
  name: `Herbst-Cup Probelauf ${tag}`, startsAt: new Date().toISOString(), format: "GROUPS_THEN_KNOCKOUT",
  startingScore: 501, inRule: "STRAIGHT", outRule: "DOUBLE", maxRounds: null, bestOfLegs: 3, bestOfSets: 1,
  participantIds: playerIds, groupCount: 4, qualifyPerGroup: 2, knockoutSize: 8, seeding: "SEEDED", boardIds,
});
if (created.status !== 201) throw new Error(`Turnier: ${created.status} ${JSON.stringify(created.data)}`);
const tournamentId: string = created.data.id;
const vis = await call("PATCH", `/organizations/${orgId}/tournaments/${tournamentId}/visibility`, { visibility: "PUBLIC" });
if (vis.status !== 200) finding("hoch", `Freigabe fehlgeschlagen HTTP ${vis.status}`, vis.data);
let dash = (await call("GET", `/organizations/${orgId}/tournaments/${tournamentId}/dashboard`, undefined, "dashboard")).data;
const publicId: string = dash.tournament.publicId;
log(`Turnier ${tournamentId} publicId ${publicId} status ${dash.tournament.status} total ${dash.tournament.totalMatches} Boards ${dash.boards.length} Queue ${dash.queue.length}`);
writeFileSync(STATUS, JSON.stringify({ tournamentId, publicId, orgId, status: dash.tournament.status, playerIds, boardIds }));
if (dash.tournament.totalMatches !== 24 + 7) finding("mittel", `totalMatches ${dash.tournament.totalMatches}, erwartet 31 (24 Gruppen + 7 KO)`);
if (dash.groups.length !== 4 || dash.groups.some((g: any) => g.rows.length !== 4)) finding("hoch", "Gruppenaufteilung nicht 4x4", dash.groups.map((g: any) => g.rows.length));
const seen = new Set<string>(); for (const g of dash.groups) for (const r of g.rows) { if (seen.has(r.playerId)) finding("kritisch", `Spieler doppelt in Gruppen: ${r.displayName}`); seen.add(r.playerId); }

// ---- Zuschauer-Socket ----
const socketOrigin = new URL(config.baseUrl).origin;
const socket: Socket = io(socketOrigin, { transports: ["websocket"] });
let lastMutationAt = 0;
socket.on("connect", () => { socket.emit("tournament:subscribe", { publicId }); log("Zuschauer-Socket verbunden und abonniert"); });
socket.on("tournament:changed", (p: any) => { stats.realtimeEvents++; stats.realtimeByType[p.eventType] = (stats.realtimeByType[p.eventType] ?? 0) + 1; if (lastMutationAt) { stats.realtimeLagMs.push(Date.now() - lastMutationAt); lastMutationAt = 0; } });
socket.on("subscription:rejected", (r: unknown) => finding("hoch", "Socket-Abo abgelehnt", r));
socket.on("disconnect", (reason) => log(`Socket getrennt: ${reason}`));

// ---- Wurfsimulation ----
function throwAt(target: Dart, p: number): Dart {
  // p = Trefferwahrscheinlichkeit auf das Zielsegment/-ring
  if (target.segment === 25) { const x = Math.random(); if (target.multiplier === 2) return x < p ? { segment: 25, multiplier: 2 } : x < p + 0.35 ? { segment: 25, multiplier: 1 } : { segment: pick([3, 17, 2, 15, 10, 6, 13, 4, 18, 1, 20, 5, 12, 9, 14, 11, 8, 16, 7, 19]), multiplier: 1 }; return x < p ? { segment: 25, multiplier: 1 } : { segment: pick([20, 3, 19, 7, 16, 8, 11, 14, 9, 12]), multiplier: 1 }; }
  const ring = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const i = ring.indexOf(target.segment); const left = ring[(i + 19) % 20]!, right = ring[(i + 1) % 20]!;
  const x = Math.random();
  if (x < p) return target;
  if (target.multiplier === 1) return x < p + 0.5 * (1 - p) ? { segment: pick([left, right]), multiplier: 1 } : x < p + 0.9 * (1 - p) ? target : { segment: pick([left, right]), multiplier: target.multiplier === 1 ? 1 : 1 };
  // Triple/Doppel verfehlt: meist Single desselben Segments, sonst Nachbar, selten ganz daneben (0)
  if (x < p + 0.55 * (1 - p)) return { segment: target.segment, multiplier: 1 };
  if (x < p + 0.85 * (1 - p)) return { segment: pick([left, right]), multiplier: 1 };
  if (x < p + 0.95 * (1 - p)) return { segment: pick([left, right]), multiplier: target.multiplier };
  return { segment: 0, multiplier: 1 };
}
function chooseTarget(remaining: number): Dart {
  if (remaining === 50) return { segment: 25, multiplier: 2 };
  if (remaining <= 40 && remaining % 2 === 0) return { segment: remaining / 2, multiplier: 2 };
  // Aufbau: Doppel stellen (bevorzugt 32/40/16/20/24)
  const prefer = [32, 40, 16, 20, 24, 8, 36, 12, 4, 28];
  if (remaining <= 60 || (remaining <= 170 && remaining > 60)) {
    for (const leave of prefer) { const need = remaining - leave; if (need <= 0) continue; if (need <= 20) return { segment: need, multiplier: 1 }; if (need <= 60 && need % 3 === 0 && need / 3 <= 20) return { segment: need / 3, multiplier: 3 }; if (need === 25) return { segment: 25, multiplier: 1 }; }
    if (remaining <= 40) return { segment: remaining - 32 > 0 && remaining - 32 <= 20 ? remaining - 32 : pick([1, 3, 5]), multiplier: 1 };
  }
  return { segment: 20, multiplier: 3 };
}
function simulateVisit(playerId: string, remaining: number): { darts: Dart[]; checkoutAttempts: number } {
  const p = skill.get(playerId) ?? 0.15; const darts: Dart[] = []; let r = remaining; let attempts = 0;
  for (let k = 0; k < 3; k++) {
    const target = chooseTarget(r);
    const pHit = target.multiplier === 3 ? p : target.multiplier === 2 ? 0.25 + p : target.segment === 25 ? 0.4 : 0.85;
    if (target.multiplier === 2) attempts++;
    const dart = throwAt(target, pHit); darts.push(dart);
    r -= dart.segment * dart.multiplier;
    if (r === 0 && dart.multiplier === 2) break; // Checkout
    if (r < 2) break; // Bust (0 ohne Doppel oder <0 oder 1)
  }
  return { darts, checkoutAttempts: attempts };
}

// ---- Scorer-Geraet je Board ----
const controllerByBoard = new Map<string, string>(boardIds.map((b) => [b, randomUUID()]));
const activeScorers = new Map<string, Promise<void>>();
let abortDone = false; let matchesStartedOnBoard2 = 0;

async function playMatch(boardId: string, tournamentMatchId: string): Promise<void> {
  const controllerId = controllerByBoard.get(boardId)!;
  // Wie ein Scorer-Geraet: Matches-Seite oeffnen und das laufende Match auf dem eigenen Board waehlen.
  const list = await call<any[]>("GET", `/organizations/${orgId}/matches`);
  const scoring = Array.isArray(list.data) ? list.data.find((x) => x.boardId === boardId && x.status === "IN_PROGRESS" && x.liveTarget?.tournamentId === tournamentId) : undefined;
  if (!scoring) { finding("hoch", `Kein laufendes Scoring-Match fuer Board ${boardId.slice(0, 4)} in der Matchliste`, { tournamentMatchId }); return; }
  const matchId: string = scoring.id; const base = `/organizations/${orgId}/matches/${matchId}`;
  const lease = await call("POST", `${base}/controller-lease`, { controllerId, force: false });
  if (lease.status !== 201 && lease.status !== 200) finding("mittel", `Controller-Lease HTTP ${lease.status}`, lease.data);
  let m = (await call("GET", base)).data;
  const names = m.participants.map((p: any) => p.displayName).join(" vs ");
  log(`[${boardId.slice(0, 4)}] Match ${matchId.slice(0, 8)} ${names} beginnt (Leg ${m.currentLegNumber}, Anwurf offen: ${m.legStartPending})`);
  matchesStartedOnBoard2 += boardId === boardIds[1] ? 1 : 0;
  const doAbort = !abortDone && boardId === boardIds[1] && matchesStartedOnBoard2 === 2;
  let visitsInMatch = 0; let guard = 0;
  while (m.status === "IN_PROGRESS" && guard++ < 400) {
    if (m.legStartPending) {
      stats.legStarts++;
      const r = await call("POST", `${base}/leg-start`, { commandId: randomUUID(), expectedVersion: m.version, legNumber: m.currentLegNumber, startingSeat: pick([1, 2]), controllerId });
      if (r.status !== 201 && r.status !== 200) { finding("hoch", `Leg-Start HTTP ${r.status}`, r.data); m = (await call("GET", base)).data; continue; }
      m = r.data; continue;
    }
    if (m.roundLimitReached) { finding("mittel", "roundLimitReached obwohl maxRounds null"); break; }
    await sleep(rnd(...VISIT_DELAY_MS));
    const side = m.participants.find((p: any) => p.isActive); if (!side) { finding("hoch", "Kein aktiver Spieler im Match", { matchId }); break; }
    if (side.playerId !== m.currentPlayerId) finding("mittel", "isActive und currentPlayerId widersprechen sich", { matchId, side: side.playerId, current: m.currentPlayerId });
    const { darts, checkoutAttempts } = simulateVisit(side.playerId, side.remaining);
    const points = darts.reduce((s, d) => s + d.segment * d.multiplier, 0);
    const expected = previewVisitOutcome({ darts, remaining: side.remaining, rules: { startingScore: m.startingScore, inRule: m.inRule, outRule: m.outRule }, openedInLeg: side.openedInLeg });
    const body = { commandId: randomUUID(), expectedVersion: m.version, playerId: side.playerId, points, dartsThrown: darts.length as 1 | 2 | 3, darts, checkoutAttempts, controllerId };
    const roll = Math.random();
    if (roll < 0.02) { // Veraltete Version (zweites Geraet / Reload) -> 409 erwartet
      stats.staleVersionProbes++;
      const stale = await call("POST", `${base}/visits`, { ...body, commandId: randomUUID(), expectedVersion: Math.max(0, m.version - 1) }, "visit");
      if (stale.status !== 409) finding("hoch", `Veraltete expectedVersion nicht abgewiesen: HTTP ${stale.status}`, stale.data);
      else if (stale.data?.error?.code !== "MATCH_VERSION_CONFLICT") finding("mittel", `409 ohne MATCH_VERSION_CONFLICT`, stale.data?.error);
      else if (!stale.data?.error?.details?.currentState && !stale.data?.error?.details) finding("niedrig", "409 ohne aktuellen Serverzustand in details", stale.data?.error);
    }
    lastMutationAt = Date.now();
    const r = await call("POST", `${base}/visits`, body, "visit"); stats.visits++; visitsInMatch++;
    if (r.status === 409) { finding("mittel", `Unerwarteter 409 beim Visit (Version ${m.version})`, r.data?.error?.code); m = (await call("GET", base)).data; continue; }
    if (r.status !== 201 && r.status !== 200) { finding("hoch", `Visit HTTP ${r.status}`, { body, error: r.data }); m = (await call("GET", base)).data; continue; }
    const after = r.data; const last = after.visits.find((v: any) => v.commandId === body.commandId);
    if (after.version !== m.version + 1) finding("mittel", `Version sprang ${m.version} -> ${after.version}`);
    if (!last || last.commandId !== body.commandId) finding("hoch", "Letzter Visit ist nicht der gesendete", { sent: body.commandId, last: last?.commandId });
    else {
      const exp = expected.outcome === "CHECKOUT" ? ["LEG_WON", "SET_WON", "MATCH_WON"] : expected.outcome === "BUST" ? ["BUST"] : ["SCORED"];
      if (!exp.includes(last.outcome)) { stats.engineMismatches++; finding("kritisch", `Engine-Abweichung: erwartet ${expected.outcome}, Server ${last.outcome}`, { remaining: side.remaining, darts, last }); }
      if (expected.outcome === "SCORED" && last.scoreAfter !== expected.remaining) { stats.engineMismatches++; finding("kritisch", `Reststand falsch: erwartet ${expected.remaining}, Server ${last.scoreAfter}`, { darts, side }); }
      if (last.outcome === "BUST") stats.visitsBust++; if (expected.outcome === "CHECKOUT") stats.visitsCheckout++;
    }
    // Netzwerkwiederholung derselben commandId (z.B. Timeout, Client sendet erneut)
    if (roll >= 0.02 && roll < 0.06) {
      stats.duplicateResends++;
      const again = await call("POST", `${base}/visits`, body, "visit");
      const dupState = again.status === 409 ? again.data?.error?.details?.currentState ?? null : again.data;
      const okStatus = again.status === 200 || again.status === 201 || again.status === 409;
      const count = (s: any) => s?.visits?.filter((v: any) => !v.reverted).length;
      if (!okStatus) finding("hoch", `Wiederholung derselben commandId: HTTP ${again.status}`, again.data);
      else if (dupState && (count(dupState) !== count(after) || dupState.version !== after.version)) finding("kritisch", "Wiederholte commandId erzeugte zweiten Visit oder neue Version", { before: after.version, after: dupState.version, status: again.status });
      else if (again.status === 409) finding("niedrig", `Wiederholte commandId antwortet 409 statt idempotent 200/201 (Zustand unveraendert)`, again.data?.error?.code);
      if (again.status === 200 || again.status === 201) m = again.data; else m = after;
    } else m = after;
    // Undo (Tippfehler) und Neueingabe
    if (roll >= 0.06 && roll < 0.085 && m.status === "IN_PROGRESS") {
      stats.undos++; await sleep(600);
      const u = await call("POST", `${base}/undo`, { commandId: randomUUID(), expectedVersion: m.version, controllerId });
      if (u.status !== 200 && u.status !== 201) finding("hoch", `Undo HTTP ${u.status}`, u.data);
      else { const s = u.data; const act = s.participants.find((p: any) => p.playerId === side.playerId); if (act?.remaining !== side.remaining) finding("kritisch", "Undo stellt Reststand nicht wieder her", { vorher: side.remaining, nachher: act?.remaining }); if (!s.participants.find((p: any) => p.isActive)?.playerId || s.currentPlayerId !== side.playerId) finding("hoch", "Nach Undo ist nicht der zurueckgenommene Spieler am Wurf", { current: s.currentPlayerId, expected: side.playerId }); m = s; }
    }
    if (doAbort && visitsInMatch === 5) {
      const a = await call("POST", `${base}/abort`, { commandId: randomUUID(), expectedVersion: m.version, controllerId, reason: "Falsche Paarung aufgerufen, Match wird neu gestartet" });
      abortDone = true;
      if (a.status !== 201 && a.status !== 200) finding("hoch", `Abbruch HTTP ${a.status}`, a.data); else log(`[${boardId.slice(0, 4)}] Match ${matchId.slice(0, 8)} abgebrochen (Stoerung A)`);
      return;
    }
  }
  if (m.status === "COMPLETED") { stats.matchesPlayed++; const w = m.participants.find((p: any) => p.playerId === m.winnerPlayerId); log(`[${boardId.slice(0, 4)}] Match ${matchId.slice(0, 8)} fertig: ${names} -> ${w?.displayName} ${m.participants.map((p: any) => p.legsWon).join(":")} (${visitsInMatch} Aufnahmen)`); }
  else finding("hoch", `Match ${matchId} nicht beendet (guard ${guard})`, { status: m.status });
}

// ---- Turnierleitung ----
async function getDashboard(): Promise<any> { const r = await call("GET", `/organizations/${orgId}/tournaments/${tournamentId}/dashboard`, undefined, "dashboard"); if (r.status !== 200) { finding("hoch", `Dashboard HTTP ${r.status}`, r.data); return dash; } return r.data; }
const seenConflicts = new Set<string>();
let withdrawalDone = false; let lastStatus = dash.tournament.status; let publicMismatchStreak = 0; let loops = 0; let idleLoops = 0;
while (loops++ < 900) {
  dash = await getDashboard();
  if (dash.tournament.status !== lastStatus) {
    log(`Turnierstatus ${lastStatus} -> ${dash.tournament.status} (${dash.tournament.stageLabel}), gespielt ${dash.tournament.playedMatches}/${dash.tournament.totalMatches}`);
    if (dash.tournament.status === "KNOCKOUT") {
      const qualified = dash.groups.flatMap((g: any) => g.rows.filter((r: any) => r.qualified).map((r: any) => r.displayName));
      const qf = dash.bracket.filter((b: any) => b.round === 1);
      log(`Qualifiziert: ${qualified.join(", ")}`); log(`Viertelfinals: ${qf.map((b: any) => b.participantNames.join(" - ")).join(" | ")}`);
      if (qualified.length !== 8) finding("hoch", `${qualified.length} Qualifizierte statt 8`);
      const qfNames = qf.flatMap((b: any) => b.participantNames);
      for (const q of qualified) if (!qfNames.includes(q)) finding("kritisch", `Qualifizierter ${q} fehlt im Viertelfinale`);
      if (new Set(qfNames).size !== qfNames.length) finding("kritisch", "Spieler doppelt im Viertelfinale", qfNames);
      for (const g of dash.groups) { const rows = [...g.rows].sort((a: any, b: any) => a.position - b.position); for (let i = 1; i < rows.length; i++) { const a = rows[i - 1], b = rows[i]; if (a.points < b.points || (a.points === b.points && a.legDifference < b.legDifference)) finding("hoch", `Tabelle ${g.groupLabel} nicht sortiert`, rows.map((r: any) => [r.displayName, r.points, r.legDifference])); } }
      for (const g of dash.groups) for (const r of g.rows) if (r.played + r.won * 0 !== r.won + r.lost) finding("mittel", `Gruppenzeile inkonsistent ${r.displayName}`, r);
      const stateOf = (s: string) => dash.bracket.filter((b: any) => b.status === s).length;
      log(`Bracket: ${dash.bracket.length} Matches, READY ${stateOf("READY")}, WAITING ${stateOf("WAITING")}`);
    }
    lastStatus = dash.tournament.status;
    writeFileSync(STATUS, JSON.stringify({ tournamentId, publicId, orgId, status: lastStatus, playerIds, boardIds }));
  }
  if (dash.tournament.status === "COMPLETED") break;
  if (dash.conflicts.length > 0) for (const c of dash.conflicts) if (!seenConflicts.has(c.id)) { seenConflicts.add(c.id); log(`Konflikt gemeldet [${c.severity}] ${c.code}: ${c.message} (${c.subject})`); }
  // Scorer auf laufenden Boards starten
  for (const b of dash.boards) {
    if (b.state === "PLAYING" && b.match && !activeScorers.has(b.match.matchId)) {
      const p = playMatch(b.boardId, b.match.matchId).catch((e) => finding("hoch", `Scorer-Fehler ${String(e)}`)).finally(() => activeScorers.delete(b.match.matchId));
      activeScorers.set(b.match.matchId, p);
    }
    if (b.state === "PLAYING" && b.match?.overrunning) log(`Board ${b.boardName}: Match ueberzieht (${b.match.stageLabel})`);
  }
  // Freie Boards mit spielbereiten Matches belegen (sequenziell, wie eine Person)
  const free = dash.boards.filter((b: any) => b.state === "FREE").map((b: any) => b.boardId);
  const ready = dash.queue.filter((q: any) => q.readiness === "READY");
  const blocked = dash.queue.filter((q: any) => q.readiness !== "READY");
  if (free.length > 0 && ready.length === 0 && blocked.length > 0 && activeScorers.size === 0) { if (++idleLoops === 5) finding("hoch", "Freie Boards, keine spielbereite Paarung, keine laufenden Matches — haengt das Turnier?", blocked.map((q: any) => [q.stageLabel, q.readiness, q.blockedReason])); } else idleLoops = 0;
  let version = dash.tournament.version;
  for (let i = 0; i < Math.min(free.length, ready.length); i++) {
    const q = ready[i]; const boardId = free[i];
    for (let attempt = 0; attempt < 3; attempt++) {
      stats.assignments++; lastMutationAt = Date.now();
      const r = await call("POST", `/organizations/${orgId}/tournaments/${tournamentId}/assignments`, { commandId: randomUUID(), expectedVersion: version, matchId: q.matchId, boardId }, "assign");
      if (r.status === 200 || r.status === 201) { version = r.data.tournament.version; log(`Zuweisung: ${q.stageLabel} ${q.participants.map((p: any) => p.displayName).join(" vs ")} -> Board ${boardId.slice(0, 4)} (v${version})`); break; }
      if (r.status === 409) { stats.assignConflicts++; const code = r.data?.error?.code; log(`Zuweisung 409 ${code}, synchronisiere`); const fresh = await getDashboard(); version = fresh.tournament.version; if (code !== "TOURNAMENT_VERSION_CONFLICT" && attempt === 2) finding("mittel", `Zuweisung dreimal 409`, r.data?.error); continue; }
      finding("hoch", `Zuweisung HTTP ${r.status}`, r.data); break;
    }
    await sleep(400);
  }
  // Stoerung B: Rueckzug in der Gruppenphase
  if (!withdrawalDone && dash.tournament.status === "GROUP_STAGE" && dash.tournament.playedMatches >= 6) {
    const playing = new Set(dash.boards.flatMap((b: any) => b.match?.participants.map((p: any) => p.playerId) ?? []));
    const candidate = dash.groups.flatMap((g: any) => g.rows).find((r: any) => r.played >= 1 && !playing.has(r.playerId) && !r.withdrawn);
    if (candidate) {
      const fresh = await getDashboard();
      const r = await call("POST", `/organizations/${orgId}/tournaments/${tournamentId}/withdrawals`, { commandId: randomUUID(), expectedVersion: fresh.tournament.version, playerId: candidate.playerId, reason: "Verletzung, abgereist" });
      withdrawalDone = true;
      if (r.status !== 200 && r.status !== 201) finding("hoch", `Rueckzug HTTP ${r.status}`, r.data);
      else { const row = r.data.groups.flatMap((g: any) => g.rows).find((x: any) => x.playerId === candidate.playerId); log(`Rueckzug ${candidate.displayName} (Stoerung B): withdrawn=${row?.withdrawn}, gespielt ${r.data.tournament.playedMatches}/${r.data.tournament.totalMatches}, Ergebnisse ${r.data.recentResults.filter((x: any) => x.resultType === "WALKOVER").length} Walkover`); if (!row?.withdrawn) finding("hoch", "Rueckzug nicht in Tabelle markiert"); }
    }
  }
  // Oeffentliche Sicht vergleichen
  if (loops % 3 === 0) {
    const pub = await call("GET", `/public/tournaments/${publicId}/live`, undefined, "publicLive");
    if (pub.status !== 200) finding("hoch", `Oeffentliche Live-Ansicht HTTP ${pub.status}`);
    else { const text = JSON.stringify(pub.data); if (text.includes(orgId)) finding("kritisch", "organizationId in oeffentlicher Antwort"); if (text.includes(tournamentId)) finding("hoch", "interne Turnier-ID in oeffentlicher Antwort"); if (pub.data.boards.some((b: any) => "blockedReason" in b)) finding("mittel", "blockedReason in oeffentlicher Board-Sicht"); const d2 = await getDashboard(); if (pub.data.tournament.playedMatches !== d2.tournament.playedMatches && pub.data.tournament.playedMatches !== dash.tournament.playedMatches) { if (++publicMismatchStreak >= 2) { stats.publicMismatch++; finding("mittel", "Oeffentliche Sicht hinkt dem Dashboard nach", { pub: pub.data.tournament.playedMatches, dash: d2.tournament.playedMatches }); } } else publicMismatchStreak = 0; }
  }
  await sleep(2500);
}


await Promise.all([...activeScorers.values()]);
dash = await getDashboard();
const winner = dash.bracket.find((b: any) => b.round === Math.max(...dash.bracket.map((x: any) => x.round)));
log(`ENDE: Status ${dash.tournament.status}, gespielt ${dash.tournament.playedMatches}/${dash.tournament.totalMatches}, Sieger ${winner?.winnerDisplayName ?? "?"}, Dauer ${Math.round((Date.now() - startedAt) / 1000)} s`);
if (dash.tournament.status !== "COMPLETED") finding("kritisch", `Turnier nicht abgeschlossen: ${dash.tournament.status}`);
if (dash.boards.some((b: any) => b.state !== "FREE")) finding("hoch", "Boards am Ende nicht frei", dash.boards.map((b: any) => [b.boardName, b.state]));
if (dash.queue.length > 0) finding("mittel", `Warteschlange am Ende nicht leer (${dash.queue.length})`, dash.queue.map((q: any) => [q.stageLabel, q.readiness]));
const played = dash.bracket.filter((b: any) => b.status === "COMPLETED").length; if (played !== 7) finding("hoch", `KO: ${played} abgeschlossene Bracket-Matches statt 7`, dash.bracket.map((b: any) => [b.round, b.status, b.resultType]));
const listed = await call("GET", `/organizations/${orgId}/tournaments`); const me = (listed.data as any[]).find((x) => x.id === tournamentId); if (me?.status !== "COMPLETED") finding("mittel", "Turnierliste zeigt nicht COMPLETED", me);
const matches = await call("GET", `/organizations/${orgId}/matches`); const mine = (matches.data as any[]).filter((m) => m.liveTarget?.tournamentId === tournamentId); const open = mine.filter((m) => m.status !== "COMPLETED"); if (open.length) finding("hoch", `${open.length} Scoring-Matches des Turniers nicht COMPLETED`, open.map((m) => m.id));
socket.close();
const summary = { tournamentId, publicId, durationS: Math.round((Date.now() - startedAt) / 1000), final: { status: dash.tournament.status, played: dash.tournament.playedMatches, total: dash.tournament.totalMatches, winner: winner?.winnerDisplayName, recentResults: dash.recentResults.length, scoringMatches: mine.length }, stats: { ...stats, durations: Object.fromEntries(Object.entries(stats.durations).map(([k, v]) => [k, { n: v.length, p50: pct(v, 0.5), p95: pct(v, 0.95), max: Math.max(0, ...v) }])), realtimeLagMs: { n: stats.realtimeLagMs.length, p50: pct(stats.realtimeLagMs, 0.5), p95: pct(stats.realtimeLagMs, 0.95), max: Math.max(0, ...stats.realtimeLagMs) } }, findings, groups: dash.groups, bracket: dash.bracket };
writeFileSync(`${OUT}.summary.json`, JSON.stringify(summary, null, 2));
log(`Zusammenfassung: ${JSON.stringify({ ...summary.stats, findings: findings.length })}`);
process.exit(0);
