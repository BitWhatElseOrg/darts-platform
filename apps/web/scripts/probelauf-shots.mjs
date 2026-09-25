/* global window */
// Browser-Kontrolle gegen Staging zum Probelauf (docs/testing/protokolle/2026-09-25-probelauf-16-spieler.md):
// Login, Turnierliste, Kommandozentrale, Live, TV, Scoringflaeche, Board-Ansicht, Matches, Mobil.
// Aufruf aus apps/web:
//   node --env-file=../../.env.staging scripts/probelauf-shots.mjs <status.json des Probelaufs> <ausgabeordner>
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
const [statusFile, outDir] = process.argv.slice(2);
const st = JSON.parse(readFileSync(statusFile, "utf8"));
mkdirSync(outDir, { recursive: true });
const web = process.env.STAGING_WEB_ORIGIN;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => consoleErrors.push("pageerror " + String(e).slice(0, 300)));
const failed = [];
page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("get-session")) failed.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`); });
async function shot(name, url, waitFor) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "networkidle" }).catch((e) => failed.push("goto " + url + " " + e.message));
  if (waitFor) await page.getByText(waitFor).first().waitFor({ timeout: 15000 }).catch(() => failed.push(`Text "${waitFor}" fehlt auf ${url}`));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  console.log(`${name}: ${Date.now() - t0} ms  ${url}  h1="${await page.locator("h1").first().textContent().catch(() => "")}"`);
}
await page.goto(web + "/");
await page.getByLabel("E-Mail").fill(process.env.STAGING_EMAIL);
await page.getByLabel("Passwort").fill(process.env.STAGING_PASSWORD);
await page.getByRole("button", { name: "Anmelden" }).click();
await page.waitForLoadState("networkidle");
await page.screenshot({ path: `${outDir}/00-nach-login.png`, fullPage: true });
await shot("01-turnierliste", `${web}/turniere?organisation=${st.orgId}`);
await shot("02-kommandozentrale", `${web}/turniere/${st.tournamentId}?organisation=${st.orgId}`);
await shot("03-live", `${web}/live/${st.publicId}`);
await shot("04-tv", `${web}/live/${st.publicId}/tv`);
// Laufendes Match auf einem Board oeffnen (Scoringflaeche + oeffentliche Board-Sicht)
const api = process.env.STAGING_API_URL;
const dash = await page.evaluate(async (u) => (await fetch(u, { credentials: "include" })).json(), `${api}/organizations/${st.orgId}/tournaments/${st.tournamentId}/dashboard`);
const playingSlot = dash.boards.find((b) => b.match);
const matches = await page.evaluate(async (u) => (await fetch(u, { credentials: "include" })).json(), `${api}/organizations/${st.orgId}/matches`);
const scoring = playingSlot ? matches.find((m) => m.boardId === playingSlot.boardId && m.status === "IN_PROGRESS") : null;
const playing = scoring ? { boardId: playingSlot.boardId, match: { matchId: scoring.id } } : null;
if (playing) {
  await shot("05-scoring", `${web}/matches/${playing.match.matchId}?organisation=${st.orgId}`);
  await shot("06-live-board", `${web}/live/${st.publicId}/board/${playing.boardId}`);
} else console.log("kein laufendes Match fuer Scoring-Screenshot");
await shot("07-matches", `${web}/matches?organisation=${st.orgId}`);
// Mobile Ansicht der Kommandozentrale und der Scoringflaeche
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
const mp = await mobile.newPage();
await mp.goto(`${web}/turniere/${st.tournamentId}?organisation=${st.orgId}`, { waitUntil: "networkidle" }); await mp.waitForTimeout(1500);
await mp.screenshot({ path: `${outDir}/08-mobil-zentrale.png`, fullPage: true });
for (const [i, y] of [0, 800, 1600].entries()) { await mp.evaluate((v) => window.scrollTo(0, v), y); await mp.waitForTimeout(300); await mp.screenshot({ path: `${outDir}/08-mobil-zentrale-${i}.png`, fullPage: false }); }
if (playing) { await mp.goto(`${web}/matches/${playing.match.matchId}?organisation=${st.orgId}`, { waitUntil: "networkidle" }); await mp.waitForTimeout(1500); await mp.screenshot({ path: `${outDir}/09-mobil-scoring.png`, fullPage: false }); }
console.log("Konsolenfehler:", JSON.stringify(consoleErrors, null, 1));
console.log("Fehlgeschlagene Antworten:", JSON.stringify(failed, null, 1));
await browser.close();
