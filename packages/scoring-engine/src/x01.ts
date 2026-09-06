const dartValues = [
  0,
  ...Array.from({ length: 20 }, (_, index) => index + 1),
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 2),
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 3),
  25,
  50,
] as const;

export type InRule = "STRAIGHT" | "DOUBLE";
export type OutRule = "SINGLE" | "DOUBLE" | "MASTER";

export interface X01Rules {
  readonly startingScore: number;
  readonly inRule: InRule;
  readonly outRule: OutRule;
  readonly maxRounds: number | null;
  readonly legsToWinSet: number;
  readonly setsToWin: number;
}

export interface X01Side {
  readonly seat: 1 | 2;
  readonly playerIds: readonly string[];
}

export interface Dart {
  readonly segment: number;
  readonly multiplier: 1 | 2 | 3;
}

export function dartValue(dart: Dart): number {
  return dart.segment * dart.multiplier;
}

export interface SubmitVisitCommand {
  readonly type: "SUBMIT_VISIT";
  readonly commandId: string;
  readonly seat: 1 | 2;
  readonly throwerPlayerId: string;
  readonly points: number;
  readonly dartsThrown: 1 | 2 | 3;
  readonly checkoutDouble?: number;
  readonly checkoutAttempts?: number;
  readonly darts?: readonly Dart[];
  /**
   * Das abschliessende Segment einer Aufnahme OHNE Einzelwuerfe, mit
   * Multiplikator — die Verallgemeinerung von `checkoutDouble`, das nur
   * D1-D20 und Bull kodieren kann (`checkoutValue`) und deshalb ein
   * Triple-Finish unter Master Out nicht belegen konnte.
   *
   * Gewertet wird es wie der letzte Wurf der Aufnahme: `closesLegWithDarts`
   * entscheidet, ob es die Ausgangsregel erfuellt; zusaetzlich muss sein Wert
   * in der Rundensumme enthalten und der Rest mit `dartsThrown - 1` Darts
   * erreichbar sein. Es schliesst sich mit `darts`, `checkoutMissed` und
   * `checkoutDouble` gegenseitig aus (`validateVisit`).
   *
   * Fehlt das Feld, aendert sich nichts: gespeicherte Kommandos ohne
   * `checkoutSegment` werden unveraendert gewertet (Replay-Sicherheit).
   */
  readonly checkoutSegment?: Dart;
  /**
   * Ausdrueckliche Meldung, dass die Aufnahme trotz Rest null KEIN gueltiges
   * Finish war (kein Doppel unter DOUBLE, kein Doppel/Triple unter MASTER
   * getroffen). Ohne dieses Feld gilt weiterhin der bisherige Rueckfall: unter
   * DOUBLE ohne `checkoutDouble` ein Bust, unter MASTER ohne `checkoutDouble`
   * die Heuristik `finishesOnMasterSegment`, unter SINGLE immer ein Finish.
   * Das Feld entscheidet nur explizit gegen ein Finish, es kann keins
   * herbeifuehren — deshalb aendert ein fehlendes Feld nichts an bereits
   * gespeicherten Kommandos (Replay-Sicherheit).
   */
  readonly checkoutMissed?: boolean;
}

export interface UndoVisitCommand {
  readonly type: "UNDO_LAST_VISIT";
  readonly commandId: string;
  readonly targetCommandId: string;
}

/**
 * Reglement 2.2.9: Leg 1 beginnt die Heimseite, Leg 2 die Gastseite, ab Leg 3
 * entscheidet ein Wurf auf Bull. Fehlt das Kommando, wechselt der Legbeginn
 * wie bisher.
 */
export interface DecideLegStartCommand {
  readonly type: "DECIDE_LEG_START";
  readonly commandId: string;
  readonly legNumber: number;
  readonly startingSeat: 1 | 2;
}

/**
 * Anhang 2 begrenzt die Automaten. Ist die Rundengrenze erreicht, endet das Leg
 * nicht durch Checkout, sondern durch ein Ausbullen.
 */
export interface DecideLegByBullCommand {
  readonly type: "DECIDE_LEG_BY_BULL";
  readonly commandId: string;
  readonly winnerSeat: 1 | 2;
}

export type X01Command =
  | SubmitVisitCommand
  | UndoVisitCommand
  | DecideLegStartCommand
  | DecideLegByBullCommand;

export interface X01Match {
  readonly sides: readonly [X01Side, X01Side];
  readonly startingSeat: 1 | 2;
  readonly rules: X01Rules;
  readonly commands: readonly X01Command[];
}

export type VisitOutcome =
  | "SCORED"
  | "BUST"
  | "LEG_WON"
  | "SET_WON"
  | "MATCH_WON";

export interface AppliedVisit {
  readonly commandId: string;
  readonly seat: 1 | 2;
  readonly throwerPlayerId: string;
  readonly legNumber: number;
  readonly points: number;
  readonly appliedPoints: number;
  readonly dartsThrown: 1 | 2 | 3;
  readonly scoreBefore: number;
  readonly scoreAfter: number;
  readonly checkoutDouble: number | null;
  readonly checkoutAttempts: number;
  readonly outcome: VisitOutcome;
  readonly darts: readonly Dart[];
}

export interface X01SideState {
  readonly seat: 1 | 2;
  readonly playerIds: readonly string[];
  readonly remaining: number;
  readonly openedInLeg: boolean;
  readonly legsWonInSet: number;
  readonly totalLegsWon: number;
  readonly setsWon: number;
}

export interface LegDecision {
  readonly commandId: string;
  readonly legNumber: number;
  readonly winnerSeat: 1 | 2;
  readonly outcome: "LEG_WON" | "SET_WON" | "MATCH_WON";
}

export interface X01MatchState {
  readonly status: "IN_PROGRESS" | "COMPLETED";
  readonly winnerSeat: 1 | 2 | null;
  readonly activeSeat: 1 | 2 | null;
  readonly activeThrowerPlayerId: string | null;
  readonly legStartingSeat: 1 | 2;
  readonly legNumber: number;
  readonly setNumber: number;
  readonly sides: readonly [X01SideState, X01SideState];
  readonly roundsPlayedInLeg: number;
  readonly roundLimitReached: boolean;
  readonly visits: readonly AppliedVisit[];
  readonly legDecisions: readonly LegDecision[];
  readonly revertedCommandIds: readonly string[];
}

export interface ExecuteX01Result {
  readonly match: X01Match;
  readonly state: X01MatchState;
  readonly duplicate: boolean;
  readonly outcome: VisitOutcome | "VISIT_UNDONE" | null;
}

export class ScoringValidationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ScoringValidationError";
  }
}

const inRules: readonly InRule[] = ["STRAIGHT", "DOUBLE"];
const outRules: readonly OutRule[] = ["SINGLE", "DOUBLE", "MASTER"];

function assertRules(rules: X01Rules): void {
  if (!Number.isInteger(rules.startingScore) || rules.startingScore < 2) {
    throw new ScoringValidationError("INVALID_STARTING_SCORE", "Starting score must be an integer of at least 2.");
  }
  if (!inRules.includes(rules.inRule)) {
    throw new ScoringValidationError("INVALID_IN_RULE", "In rule must be STRAIGHT or DOUBLE.");
  }
  if (!outRules.includes(rules.outRule)) {
    throw new ScoringValidationError("INVALID_OUT_RULE", "Out rule must be SINGLE, DOUBLE or MASTER.");
  }
  if (rules.maxRounds !== null && (!Number.isInteger(rules.maxRounds) || rules.maxRounds < 1)) {
    throw new ScoringValidationError("INVALID_MAX_ROUNDS", "The round limit must be a positive integer or null.");
  }
  if (!Number.isInteger(rules.legsToWinSet) || rules.legsToWinSet < 1) {
    throw new ScoringValidationError("INVALID_LEG_TARGET", "Leg target must be a positive integer.");
  }
  if (!Number.isInteger(rules.setsToWin) || rules.setsToWin < 1) {
    throw new ScoringValidationError("INVALID_SET_TARGET", "Set target must be a positive integer.");
  }
}

function seatOf(index: 0 | 1): 1 | 2 {
  return index === 0 ? 1 : 2;
}

function indexOfSeat(seat: 1 | 2): 0 | 1 {
  return seat === 1 ? 0 : 1;
}

function throwerFor(side: X01Side, visitsInLeg: number, legNumber: number): string {
  const position = (visitsInLeg + legNumber - 1) % side.playerIds.length;
  const playerId = side.playerIds[position];
  if (playerId === undefined) {
    throw new ScoringValidationError("EMPTY_SIDE", "A side needs at least one player.");
  }
  return playerId;
}

export function createX01Match(input: {
  readonly sides: readonly [X01Side, X01Side];
  readonly startingSeat?: 1 | 2;
  readonly rules?: X01Rules;
}): X01Match {
  const [first, second] = input.sides;
  // Die Projektion leitet den Sitz aus der Position im Tupel ab. Traegt eine
  // Seite einen anderen Sitz als ihre Position, sagen `side.seat` und die
  // Engine Verschiedenes — und Kommandos landeten bei der falschen Seite.
  if (first.seat !== 1 || second.seat !== 2) {
    throw new ScoringValidationError(
      "INVALID_SEATS",
      "The first side holds seat 1 and the second seat 2.",
    );
  }
  if (first.playerIds.length === 0 || second.playerIds.length === 0) {
    throw new ScoringValidationError("EMPTY_SIDE", "A side needs at least one player.");
  }
  const all = [...first.playerIds, ...second.playerIds];
  if (new Set(all).size !== all.length) {
    throw new ScoringValidationError("DUPLICATE_PLAYER", "A person can only appear once in a match.");
  }
  const rules = input.rules ?? {
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    maxRounds: null,
    legsToWinSet: 1,
    setsToWin: 1,
  };
  assertRules(rules);
  return {
    sides: input.sides,
    startingSeat: input.startingSeat ?? 1,
    rules,
    commands: [],
  };
}

const attainableByDarts = new Map<number, ReadonlySet<number>>();

function attainableTotals(darts: number): ReadonlySet<number> {
  const cached = attainableByDarts.get(darts);
  if (cached !== undefined) return cached;
  let totals = new Set<number>([0]);
  for (let dart = 0; dart < darts; dart += 1) {
    const next = new Set<number>();
    for (const total of totals) {
      for (const value of dartValues) next.add(total + value);
    }
    totals = next;
  }
  attainableByDarts.set(darts, totals);
  return totals;
}

export function isAttainableScore(points: number, dartsThrown: 1 | 2 | 3): boolean {
  return Number.isInteger(points) && points >= 0 && attainableTotals(dartsThrown).has(points);
}

function checkoutValue(segment: number): number | null {
  if (segment === 25) return 50;
  if (Number.isInteger(segment) && segment >= 1 && segment <= 20) return segment * 2;
  return null;
}

const masterFinishes: readonly number[] = [
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 2),
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 3),
  50,
];

/**
 * Master Out schliesst auf einem Doppel oder einem Triple; Bull (50) zaehlt als
 * Doppel 25, das aeussere Bull (25) ist ein Single und schliesst nicht. Ohne
 * festgehaltenes Segment prueft die Engine, ob der Visit ueberhaupt so
 * geworfen werden konnte.
 */
function finishesOnMasterSegment(points: number, dartsThrown: 1 | 2 | 3): boolean {
  return masterFinishes.some(
    (value) => points >= value && attainableTotals(dartsThrown - 1).has(points - value),
  );
}

const doubleValues: readonly number[] = [
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 2),
  50,
];

/**
 * Double In eroeffnet auf einem Doppel als erstem Dart des Visits. Ohne
 * festgehaltenes Segment prueft die Engine, ob der Visit so geworfen werden
 * konnte.
 */
function opensOnDouble(points: number, dartsThrown: 1 | 2 | 3): boolean {
  return doubleValues.some(
    (value) => points >= value && attainableTotals(dartsThrown - 1).has(points - value),
  );
}

function closesLeg(
  outRule: OutRule,
  command: SubmitVisitCommand,
  validDoubleCheckout: boolean,
): boolean {
  switch (outRule) {
    case "SINGLE":
      return true;
    case "DOUBLE":
      return validDoubleCheckout;
    case "MASTER":
      return command.checkoutDouble === undefined
        ? finishesOnMasterSegment(command.points, command.dartsThrown)
        : validDoubleCheckout;
  }
}

function isValidDart(dart: Dart): boolean {
  if (!Number.isInteger(dart.segment) || dart.segment < 0) return false;
  if (dart.segment > 20 && dart.segment !== 25) return false;
  if (dart.segment === 0) return dart.multiplier === 1;
  if (dart.segment === 25) return dart.multiplier <= 2;
  return true;
}

function dartsTotal(darts: readonly Dart[]): number {
  return darts.reduce((sum, dart) => sum + dartValue(dart), 0);
}

/**
 * Double In: die Aufnahme zaehlt erst ab dem ersten Doppel. Wuerfe davor sind
 * keine Regelverletzung, sie zaehlen bloss nicht. Segment 0 traegt nie einen
 * Multiplikator, ein Doppel ist deshalb immer ein Treffer.
 */
function openingDartIndex(darts: readonly Dart[]): number {
  return darts.findIndex((dart) => dart.multiplier === 2);
}

/**
 * Ein Rest, den ein Doppel schliessen kann. Grundlage fuer die Zaehlung der
 * Checkout-Versuche; bei Master Out gilt dieselbe Definition, weil der
 * Doppelversuch die berichtete Groesse ist.
 */
function isFinishPosition(remaining: number): boolean {
  return remaining === 50 || (remaining > 0 && remaining <= 40 && remaining % 2 === 0);
}

/**
 * Zaehlt die DARTS, die aus einer Finish-Position abgegeben wurden — die
 * uebliche Definition des Nenners der Checkout-Quote.
 *
 * ACHTUNG, Einheitenbruch: `checkoutAttempts` traegt damit je nach Aufnahme
 * eine andere Einheit. Ohne Einzelwuerfe uebernimmt die Engine den Wert des
 * Kommandos, und die Flaeche meldet dort 0 oder 1 — also eine AUFNAHMENZAHL.
 * Mit Einzelwuerfen steht hier eine WURFZAHL von 0 bis 3. Beides landet in
 * derselben Spalte `visits.checkout_attempts`; Karrierewerte ueber den
 * Umstellungszeitpunkt hinweg mischen die beiden Einheiten. Bewusst so
 * belassen: fuer Aufnahmen ohne Wurfdaten laesst sich die Wurfzahl nicht
 * rekonstruieren. Siehe DATABASE_SCHEMA.md, Abschnitt 10
 * („Visit-Kommando: `checkoutAttempts` — zwei Einheiten in einer Spalte").
 */
function checkoutAttemptsFromDarts(scoreBefore: number, darts: readonly Dart[], outRule: OutRule): number {
  if (outRule === "SINGLE") return 0;
  let remaining = scoreBefore;
  let attempts = 0;
  for (const dart of darts) {
    if (isFinishPosition(remaining)) attempts += 1;
    remaining -= dartValue(dart);
    if (remaining < 0) break;
  }
  return attempts;
}

/**
 * Ableitung von `checkoutAttempts`, wenn ein Kommando ohne Einzelwuerfe das
 * Feld nicht mitgibt: ein gemeldetes `checkoutDouble`, `checkoutSegment` oder
 * ein ausdruecklich gemeldeter Fehlversuch (`checkoutMissed`) zaehlt als ein
 * Versuch, sonst null. Exportiert, damit ein Aufrufer, der das gespeicherte
 * Kommando VOR der Ausfuehrung materialisieren muss (z.B. die API, damit ein
 * Replay denselben Wert sieht wie die Schreibzeit), dieselbe Regel verwendet
 * statt einer zweiten Kopie (PR-Agent-Runde 3, Befund B).
 */
export function defaultCheckoutAttempts(command: {
  readonly checkoutDouble?: number;
  readonly checkoutSegment?: Dart;
  readonly checkoutMissed?: boolean;
}): 0 | 1 {
  return command.checkoutDouble === undefined && command.checkoutSegment === undefined && command.checkoutMissed !== true
    ? 0
    : 1;
}

function closesLegWithDarts(outRule: OutRule, finishing: Dart): boolean {
  switch (outRule) {
    case "SINGLE":
      return true;
    case "DOUBLE":
      return finishing.multiplier === 2;
    case "MASTER":
      return finishing.multiplier >= 2;
  }
}

/**
 * Der Wurf, der das Leg schliesst — wurfweise statt ueber die Gesamtsumme.
 * Geliefert wird der Index des ersten Wurfs, der den Rest auf null bringt UND
 * die Ausgangsregel erfuellt (`closesLegWithDarts`: SINGLE jeder Wurf, DOUBLE
 * nur ein Doppel, MASTER Doppel oder Triple); `-1`, wenn keiner das tut.
 *
 * Double In: vor dem eroeffnenden Doppel zaehlt kein Wurf (`openingDartIndex`,
 * dieselbe Zaehlung wie in `projectX01Match`), also kann ein Wurf davor das Leg
 * auch dann nicht schliessen, wenn die Summe passte.
 *
 * Abbruch bei Bust: ueberwirft ein Wurf oder laesst er Rest eins stehen, endet
 * die Aufnahme fachlich. Ein spaeterer Wurf kann den Rest ohnehin nicht mehr
 * auf null zurueckholen (Wurfwerte sind nie negativ), der Abbruch ist also nur
 * ausgesprochen, was die Rechnung ohnehin ergibt. Bewusst NICHT abgelehnt
 * werden Wuerfe NACH einem solchen Bust: die Engine wertet die Aufnahme als
 * Ganzes und kommt dabei zum selben Bust — es entsteht kein falscher Zustand,
 * waehrend eine Ablehnung bereits gespeicherte, korrekt gewertete Kommandos im
 * Replay scheitern liesse. Abgelehnt wird nur, was heute falsch gewertet wird:
 * ein Wurf nach dem Legabschluss.
 */
function legClosingDartIndex(input: {
  readonly darts: readonly Dart[];
  readonly scoreBefore: number;
  readonly openedInLeg: boolean;
  readonly outRule: OutRule;
}): number {
  let remaining = input.scoreBefore;
  let counting = input.openedInLeg;
  for (const [index, dart] of input.darts.entries()) {
    if (!counting) {
      if (dart.multiplier !== 2) continue;
      counting = true;
    }
    remaining -= dartValue(dart);
    if (remaining === 0 && closesLegWithDarts(input.outRule, dart)) return index;
    if (remaining <= 0) break;
    if (input.outRule !== "SINGLE" && remaining === 1) break;
  }
  return -1;
}

/**
 * Ein Rest unter null ist immer Bust; ein Rest von genau eins ist es bei
 * jeder Ausgangsregel ausser Straight Out, weil ihn kein einzelner Wurf mehr
 * regelkonform schliesst; ein Rest von genau null ist Bust, wenn der
 * schliessende Wurf die Ausgangsregel nicht erfuellt. Von `projectX01Match`
 * und `previewVisitOutcome` gemeinsam genutzt, damit Server-Wertung und
 * Vorschau nicht auseinanderlaufen koennen.
 */
function isBust(outRule: OutRule, tentative: number, validCheckout: boolean): boolean {
  return tentative < 0 || (outRule !== "SINGLE" && tentative === 1) || (tentative === 0 && !validCheckout);
}

export type VisitPreviewOutcome = "OPEN" | "SCORED" | "BUST" | "CHECKOUT";

/**
 * Die Vorschau traegt dieselbe Unterscheidung wie `AppliedVisit` und
 * `SubmitVisitCommand`: `points` ist die ROHE Summe der geworfenen Darts,
 * `appliedPoints` die tatsaechlich ANGERECHNETE. Unter Double In laufen die
 * beiden auseinander, solange die Seite das Leg noch nicht eroeffnet hat
 * (T20/T20/D20 auf 501: `points` 160, `appliedPoints` 40).
 *
 * Wer eine Aufnahme absendet, muss `points` uebertragen: `validateVisit`
 * prueft die Wurfsumme gegen `command.points` (DART_SUM_MISMATCH), und die
 * Anrechnung nimmt `projectX01Match` selbst vor. `appliedPoints` ist reine
 * Anzeige.
 *
 * Ein Unterschied zu `AppliedVisit.appliedPoints` bleibt: dort ist der Wert
 * bei einem Bust null, hier traegt er auch dann die nach der In-Regel
 * angerechnete Summe. Die Vorschau meldet den Bust ueber `outcome`, und die
 * Flaeche am Board zeigt in dem Fall die geworfene Zahl, nicht eine Null.
 */
export interface VisitOutcomePreview {
  readonly points: number;
  readonly appliedPoints: number;
  readonly remaining: number;
  readonly complete: boolean;
  readonly outcome: VisitPreviewOutcome;
}

/**
 * Reine Vorschau einer laufenden Aufnahme (bis zu drei Wuerfe), ohne den
 * Matchzustand zu veraendern. Nutzt dieselbe Regel-Logik wie
 * `projectX01Match` (Double-In-Zaehlung, Checkout-Erkennung ueber
 * `closesLegWithDarts`, Bust-Erkennung ueber `isBust`), damit die Vorschau in
 * der UI nicht von der Server-Wertung abweichen kann. Verbindlich bleibt in
 * jedem Fall die Antwort der Engine auf dem Server.
 *
 * Ob das Leg fuer diese Seite bereits eroeffnet ist, kennt nur der
 * Matchzustand selbst (`X01SideState.openedInLeg`); der uebertragene
 * Matchzustand (`matchStateSchema`/`matchParticipantStateSchema`) fuehrt
 * dieses Feld aber nicht. Ist `openedInLeg` nicht gesetzt, greift ein
 * abgeleiteter Rueckfall: bei Double In bleibt der Reststand beim Startwert,
 * bis der erste Punkt zaehlt, bei Straight In ist die Seite von Anfang an
 * eroeffnet.
 *
 * Dieser Rueckfall ist NICHT exakt: `projectX01Match` schreibt `openedInLeg`
 * im Bust-Zweig dauerhaft fort, ohne `remaining` zu aendern (x01.ts:691 —
 * `const openedInLeg = side.openedInLeg || countedPoints > 0;` — und
 * x01.ts:720 — `replaceSide(sides, activeIndex, { ...side, openedInLeg })`
 * ohne `remaining`). Wer also mit einem Doppel eroeffnet und
 * in derselben Aufnahme ueberwirft, hat danach `openedInLeg: true` bei
 * `remaining === startingScore` — der Rueckfall liest daraus faelschlich
 * "noch nicht eroeffnet". Das kann nur passieren, wenn eine Aufnahme ab dem
 * eroeffnenden Doppel mindestens `startingScore - 1` Punkte zaehlt; bei
 * hoechstens 180 Punkten pro Aufnahme ist das nur fuer `startingScore <= 181`
 * ueberhaupt erreichbar. Fuer die heute produktiv erreichbaren Startwerte
 * (301/501/701) haelt der Rueckfall uneingeschraenkt. Wer `startingScore`
 * darunter verwendet oder Gewissheit braucht, muss `openedInLeg` explizit
 * mitgeben — der Rueckfall ist ein Notbehelf, keine Ersatz-Wahrheit.
 */
export function previewVisitOutcome(input: {
  readonly darts: readonly Dart[];
  readonly remaining: number;
  readonly rules: {
    readonly startingScore: number;
    readonly inRule: InRule;
    readonly outRule: OutRule;
  };
  readonly openedInLeg?: boolean;
}): VisitOutcomePreview {
  const { darts, remaining, rules } = input;
  const openedInLeg =
    input.openedInLeg ?? (rules.inRule !== "DOUBLE" || remaining < rules.startingScore);
  const opening = openingDartIndex(darts);
  const countedDarts = openedInLeg ? darts : opening === -1 ? [] : darts.slice(opening);
  const points = dartsTotal(darts);
  const appliedPoints = dartsTotal(countedDarts);
  const tentative = remaining - appliedPoints;
  const finishing = darts.at(-1) ?? null;
  const checkout = tentative === 0 && finishing !== null && closesLegWithDarts(rules.outRule, finishing);
  const bust = isBust(rules.outRule, tentative, checkout);
  if (checkout) return { points, appliedPoints, remaining: 0, complete: true, outcome: "CHECKOUT" };
  if (bust) return { points, appliedPoints, remaining, complete: true, outcome: "BUST" };
  return {
    points,
    appliedPoints,
    remaining: tentative,
    complete: darts.length >= 3,
    outcome: darts.length >= 3 ? "SCORED" : "OPEN",
  };
}

function validateVisit(command: SubmitVisitCommand): void {
  if (!isAttainableScore(command.points, command.dartsThrown)) {
    throw new ScoringValidationError("INVALID_VISIT_SCORE", `${command.points} cannot be scored with ${command.dartsThrown} dart(s).`);
  }
  if (command.checkoutDouble !== undefined && checkoutValue(command.checkoutDouble) === null) {
    throw new ScoringValidationError("INVALID_CHECKOUT_DOUBLE", "Checkout double must be D1-D20 or bull (25).");
  }
  if (command.checkoutAttempts !== undefined && (!Number.isInteger(command.checkoutAttempts) || command.checkoutAttempts < 0 || command.checkoutAttempts > command.dartsThrown)) {
    throw new ScoringValidationError("INVALID_CHECKOUT_ATTEMPTS", "Checkout attempts must be between zero and the number of darts thrown.");
  }
  if (command.checkoutMissed === true && command.checkoutDouble !== undefined) {
    throw new ScoringValidationError("INVALID_CHECKOUT_MISSED", "Checkout missed cannot be combined with a checkout double.");
  }
  if (command.checkoutMissed === true && command.darts !== undefined) {
    throw new ScoringValidationError("INVALID_CHECKOUT_MISSED", "Checkout missed cannot be combined with recorded darts.");
  }
  if (command.checkoutSegment !== undefined) {
    if (!isValidDart(command.checkoutSegment)) {
      throw new ScoringValidationError("INVALID_CHECKOUT_SEGMENT", "A checkout segment must hit 0-20 or bull, with a valid multiplier.");
    }
    // Ein zweiter Beleg zur selben Aufnahme ist nicht entscheidbar: mit
    // Einzelwuerfen entscheidet der letzte Wurf, `checkoutMissed` spricht
    // ausdruecklich gegen ein Finish, `checkoutDouble` nennt bereits ein
    // Segment.
    if (command.darts !== undefined || command.checkoutMissed === true || command.checkoutDouble !== undefined) {
      throw new ScoringValidationError(
        "INVALID_CHECKOUT_SEGMENT",
        "A checkout segment cannot be combined with recorded darts, a missed checkout or a checkout double.",
      );
    }
  }
  if (command.darts !== undefined) {
    if (command.darts.length !== command.dartsThrown) {
      throw new ScoringValidationError("INVALID_DART_COUNT", "The number of darts must match the darts thrown.");
    }
    if (!command.darts.every(isValidDart)) {
      throw new ScoringValidationError("INVALID_DART", "A dart must hit 0-20 or bull, with a valid multiplier.");
    }
    if (dartsTotal(command.darts) !== command.points) {
      throw new ScoringValidationError("DART_SUM_MISMATCH", "The darts must add up to the visit score.");
    }
  }
}

function initialSide(side: X01Side, rules: X01Rules): X01SideState {
  return {
    seat: side.seat,
    playerIds: side.playerIds,
    remaining: rules.startingScore,
    openedInLeg: rules.inRule === "STRAIGHT",
    legsWonInSet: 0,
    totalLegsWon: 0,
    setsWon: 0,
  };
}

function replaceSide(
  sides: readonly [X01SideState, X01SideState],
  index: 0 | 1,
  side: X01SideState,
): [X01SideState, X01SideState] {
  return index === 0 ? [side, sides[1]] : [sides[0], side];
}

function other(index: 0 | 1): 0 | 1 {
  return index === 0 ? 1 : 0;
}

type StreamCommand = SubmitVisitCommand | DecideLegByBullCommand;

interface ActiveCommands {
  readonly stream: readonly StreamCommand[];
  readonly submissions: readonly SubmitVisitCommand[];
  readonly reverted: readonly string[];
  readonly legStarts: ReadonlyMap<number, 1 | 2>;
}

function activeCommands(commands: readonly X01Command[]): ActiveCommands {
  const reverted = new Set(
    commands
      .filter((command): command is UndoVisitCommand => command.type === "UNDO_LAST_VISIT")
      .map((command) => command.targetCommandId),
  );
  const legStarts = new Map<number, 1 | 2>();
  for (const command of commands) {
    if (command.type !== "DECIDE_LEG_START") continue;
    if (!Number.isInteger(command.legNumber) || command.legNumber < 3) {
      throw new ScoringValidationError(
        "LEG_START_FIXED",
        "Leg one belongs to the home side and leg two to the guest side.",
      );
    }
    if (legStarts.has(command.legNumber)) {
      throw new ScoringValidationError(
        "LEG_START_ALREADY_SET",
        "The starting side of that leg is already decided.",
      );
    }
    legStarts.set(command.legNumber, command.startingSeat);
  }
  return {
    stream: commands.filter(
      (command): command is StreamCommand =>
        (command.type === "SUBMIT_VISIT" && !reverted.has(command.commandId)) ||
        command.type === "DECIDE_LEG_BY_BULL",
    ),
    submissions: commands.filter(
      (command): command is SubmitVisitCommand =>
        command.type === "SUBMIT_VISIT" && !reverted.has(command.commandId),
    ),
    reverted: [...reverted],
    legStarts,
  };
}

interface LegWin {
  readonly sides: [X01SideState, X01SideState];
  readonly outcome: "LEG_WON" | "SET_WON" | "MATCH_WON";
  readonly setWon: boolean;
  readonly matchWon: boolean;
}

function winLeg(
  sides: readonly [X01SideState, X01SideState],
  index: 0 | 1,
  rules: X01Rules,
): LegWin {
  const side = sides[index];
  const legsWonInSet = side.legsWonInSet + 1;
  const setWon = legsWonInSet >= rules.legsToWinSet;
  const setsWon = side.setsWon + (setWon ? 1 : 0);
  const matchWon = setsWon >= rules.setsToWin;
  const winner = replaceSide(sides, index, {
    ...side,
    remaining: 0,
    legsWonInSet: setWon ? 0 : legsWonInSet,
    totalLegsWon: side.totalLegsWon + 1,
    setsWon,
  });
  // Mit dem Satzgewinn beginnt die Legzaehlung des Satzes fuer BEIDE Seiten
  // neu. Wurde nur die gewinnende Seite zurueckgesetzt, nahm die unterlegene
  // ihre Legs aus dem verlorenen Satz in den naechsten mit und gewann ihn mit
  // entsprechend weniger Legs (Satz 1 mit 3:2 verloren, Satz 2 danach mit
  // einem einzigen Leg gewonnen).
  const loserIndex = other(index);
  const sidesAfterSet = setWon
    ? replaceSide(winner, loserIndex, { ...winner[loserIndex], legsWonInSet: 0 })
    : winner;
  return {
    sides: sidesAfterSet,
    outcome: matchWon ? "MATCH_WON" : setWon ? "SET_WON" : "LEG_WON",
    setWon,
    matchWon,
  };
}

function resetForNextLeg(
  sides: readonly [X01SideState, X01SideState],
  rules: X01Rules,
): [X01SideState, X01SideState] {
  const opened = rules.inRule === "STRAIGHT";
  return [
    { ...sides[0], remaining: rules.startingScore, openedInLeg: opened },
    { ...sides[1], remaining: rules.startingScore, openedInLeg: opened },
  ];
}

/** Eine Runde ist vollstaendig, wenn beide Seiten im Leg gleich oft geworfen haben. */
function roundsCompleted(visitsInLeg: readonly [number, number]): number {
  return Math.min(visitsInLeg[0], visitsInLeg[1]);
}

function isRoundLimitReached(
  maxRounds: number | null,
  visitsInLeg: readonly [number, number],
): boolean {
  return maxRounds !== null && roundsCompleted(visitsInLeg) >= maxRounds;
}

function nextLegStartIndex(
  legStarts: ReadonlyMap<number, 1 | 2>,
  nextLegNumber: number,
  previous: 0 | 1,
): 0 | 1 {
  const decided = legStarts.get(nextLegNumber);
  return decided === undefined ? other(previous) : indexOfSeat(decided);
}

export function projectX01Match(match: X01Match): X01MatchState {
  assertRules(match.rules);
  const active = activeCommands(match.commands);
  let sides: [X01SideState, X01SideState] = [
    initialSide(match.sides[0], match.rules),
    initialSide(match.sides[1], match.rules),
  ];
  let activeIndex: 0 | 1 = indexOfSeat(match.startingSeat);
  let legStartingIndex: 0 | 1 = activeIndex;
  let visitsInLeg: [number, number] = [0, 0];
  let legNumber = 1;
  let setNumber = 1;
  let winnerSeat: 1 | 2 | null = null;
  const visits: AppliedVisit[] = [];
  const decisions: LegDecision[] = [];

  for (const command of active.stream) {
    if (winnerSeat !== null) {
      throw new ScoringValidationError("MATCH_ALREADY_COMPLETED", "No command can be added to a completed match.");
    }

    if (command.type === "DECIDE_LEG_BY_BULL") {
      if (!isRoundLimitReached(match.rules.maxRounds, visitsInLeg)) {
        throw new ScoringValidationError(
          "ROUND_LIMIT_NOT_REACHED",
          "A leg is only decided by bull once the round limit is reached.",
        );
      }
      const won = winLeg(sides, indexOfSeat(command.winnerSeat), match.rules);
      sides = won.sides;
      decisions.push({
        commandId: command.commandId,
        legNumber,
        winnerSeat: command.winnerSeat,
        outcome: won.outcome,
      });
      if (won.matchWon) {
        winnerSeat = command.winnerSeat;
        continue;
      }
      legNumber += 1;
      if (won.setWon) setNumber += 1;
      legStartingIndex = nextLegStartIndex(active.legStarts, legNumber, legStartingIndex);
      activeIndex = legStartingIndex;
      visitsInLeg = [0, 0];
      sides = resetForNextLeg(sides, match.rules);
      continue;
    }

    if (isRoundLimitReached(match.rules.maxRounds, visitsInLeg)) {
      throw new ScoringValidationError(
        "ROUND_LIMIT_REACHED",
        "The round limit is reached; the leg is decided by a bull throw.",
      );
    }
    validateVisit(command);
    const side = sides[activeIndex];
    if (command.seat !== seatOf(activeIndex)) {
      throw new ScoringValidationError("NOT_ACTIVE_SEAT", "The visit does not belong to the active side.");
    }
    const expectedThrower = throwerFor(match.sides[activeIndex], visitsInLeg[activeIndex], legNumber);
    if (command.throwerPlayerId !== expectedThrower) {
      throw new ScoringValidationError("INVALID_THROWER", "The visit does not belong to the person whose turn it is.");
    }
    const darts = command.darts;
    let countedPoints = command.points;
    if (!side.openedInLeg) {
      if (darts === undefined) {
        if (command.points > 0 && !opensOnDouble(command.points, command.dartsThrown)) {
          throw new ScoringValidationError(
            "DOUBLE_IN_REQUIRED",
            "The first scoring visit of a leg must start on a double.",
          );
        }
      } else {
        const opening = openingDartIndex(darts);
        countedPoints = opening === -1 ? 0 : dartsTotal(darts.slice(opening));
      }
    }
    const openedInLeg = side.openedInLeg || countedPoints > 0;
    const scoreBefore = side.remaining;
    // Kommandovalidierung mit Regelkontext: was `validateVisit` prueft, kommt
    // ohne Matchzustand aus, diese Regel nicht — sie braucht Reststand,
    // Eroeffnungsstand und Ausgangsregel. Schliesst ein Wurf das Leg, darf kein
    // weiterer folgen. Die Flaeche verhindert das schon in der Eingabe
    // (`dartEntryReducer`), aber ein handgebautes Kommando oder ein
    // Score-Provider-Adapter ist daran nicht gebunden — und die Wertung ueber
    // die Gesamtsumme wuerde daraus faelschlich einen Bust machen
    // (Rest 40, `[D20, Fehlwurf]` unter Double Out).
    if (darts !== undefined) {
      const closingIndex = legClosingDartIndex({
        darts,
        scoreBefore,
        openedInLeg: side.openedInLeg,
        outRule: match.rules.outRule,
      });
      if (closingIndex !== -1 && closingIndex < darts.length - 1) {
        throw new ScoringValidationError(
          "DARTS_AFTER_LEG_CLOSED",
          "No dart can follow the dart that closes the leg.",
        );
      }
    }
    const tentative = scoreBefore - countedPoints;
    const doubleValue = command.checkoutDouble === undefined ? null : checkoutValue(command.checkoutDouble);
    const finishingDart = darts === undefined ? null : (darts.at(-1) ?? null);
    const validDoubleCheckout =
      doubleValue !== null &&
      command.points >= doubleValue &&
      attainableTotals(command.dartsThrown - 1).has(command.points - doubleValue);
    // Das gemeldete Abschluss-Segment wird wie der letzte Wurf gewertet: es
    // muss die Ausgangsregel erfuellen, sein Wert in der Rundensumme stecken
    // und der Rest mit den uebrigen Darts erreichbar sein — dieselben zwei
    // Bedingungen, die `validDoubleCheckout` an `checkoutDouble` stellt.
    const declaredFinish = command.checkoutSegment ?? null;
    const validSegmentCheckout =
      declaredFinish !== null &&
      closesLegWithDarts(match.rules.outRule, declaredFinish) &&
      command.points >= dartValue(declaredFinish) &&
      attainableTotals(command.dartsThrown - 1).has(command.points - dartValue(declaredFinish));
    const validCheckout =
      tentative === 0 &&
      command.checkoutMissed !== true &&
      (finishingDart !== null
        ? closesLegWithDarts(match.rules.outRule, finishingDart)
        : declaredFinish !== null
          ? validSegmentCheckout
          : closesLeg(match.rules.outRule, command, validDoubleCheckout));
    const bust = isBust(match.rules.outRule, tentative, validCheckout);
    let outcome: VisitOutcome = bust ? "BUST" : "SCORED";
    let scoreAfter = bust ? scoreBefore : tentative;
    let setWonByVisit = false;

    if (validCheckout) {
      const won = winLeg(sides, activeIndex, match.rules);
      sides = won.sides;
      outcome = won.outcome;
      setWonByVisit = won.setWon;
      scoreAfter = 0;
      if (won.matchWon) {
        winnerSeat = seatOf(activeIndex);
      }
    } else if (bust) {
      sides = replaceSide(sides, activeIndex, { ...side, openedInLeg });
    } else {
      sides = replaceSide(sides, activeIndex, { ...side, remaining: tentative, openedInLeg });
    }

    const derivedCheckoutDouble =
      finishingDart !== null && validCheckout && finishingDart.multiplier === 2
        ? finishingDart.segment
        : null;
    // Ein gemeldetes Abschluss-Segment fuellt `checkoutDouble` genau dann,
    // wenn es ein Doppel war — die Statistik zaehlt darueber die getroffenen
    // Doppel. Ein Triple-Finish unter Master Out traegt weiterhin null; das
    // Feld kann kein Triple kodieren (`checkoutValue`).
    const segmentCheckoutDouble =
      declaredFinish !== null && validCheckout && declaredFinish.multiplier === 2
        ? declaredFinish.segment
        : null;

    visits.push({
      commandId: command.commandId,
      seat: command.seat,
      throwerPlayerId: command.throwerPlayerId,
      legNumber,
      points: command.points,
      appliedPoints: bust ? 0 : countedPoints,
      dartsThrown: command.dartsThrown,
      scoreBefore,
      scoreAfter,
      checkoutDouble: darts === undefined ? (command.checkoutDouble ?? segmentCheckoutDouble) : derivedCheckoutDouble,
      checkoutAttempts:
        darts === undefined
          ? (command.checkoutAttempts ?? defaultCheckoutAttempts(command))
          : checkoutAttemptsFromDarts(scoreBefore, darts, match.rules.outRule),
      outcome,
      darts: darts ?? [],
    });

    visitsInLeg =
      activeIndex === 0
        ? [visitsInLeg[0] + 1, visitsInLeg[1]]
        : [visitsInLeg[0], visitsInLeg[1] + 1];

    if (validCheckout && winnerSeat === null) {
      legNumber += 1;
      if (setWonByVisit) setNumber += 1;
      legStartingIndex = nextLegStartIndex(active.legStarts, legNumber, legStartingIndex);
      activeIndex = legStartingIndex;
      visitsInLeg = [0, 0];
      sides = resetForNextLeg(sides, match.rules);
    } else if (!validCheckout) {
      activeIndex = other(activeIndex);
    }
  }

  return {
    status: winnerSeat === null ? "IN_PROGRESS" : "COMPLETED",
    winnerSeat,
    activeSeat: winnerSeat === null ? seatOf(activeIndex) : null,
    activeThrowerPlayerId:
      winnerSeat === null
        ? throwerFor(match.sides[activeIndex], visitsInLeg[activeIndex], legNumber)
        : null,
    legStartingSeat: seatOf(legStartingIndex),
    legNumber,
    setNumber,
    sides,
    roundsPlayedInLeg: roundsCompleted(visitsInLeg),
    roundLimitReached: isRoundLimitReached(match.rules.maxRounds, visitsInLeg),
    visits,
    legDecisions: decisions,
    revertedCommandIds: active.reverted,
  };
}

/**
 * Regeln, die NUR fuer neue Kommandos gelten. Sie liegen bewusst im
 * Schreibpfad und nicht in `projectX01Match`: gespeicherte Kommandos dieser
 * Form tragen heute einen falschen oder geratenen Stand, doch eine Ablehnung
 * beim Replay machte die betroffenen Matches unlesbar (Event Sourcing — jedes
 * Lesen baut den Zustand aus dem Kommando-Strom neu auf). Die Projektion
 * wertet gespeicherte Kommandos deshalb unveraendert weiter; die Korrektur
 * greift ab dem naechsten Kommando.
 *
 * Der Eroeffnungsstand kommt aus dem Zustand vor dem Kommando
 * (`X01SideState.openedInLeg`), damit die Eroeffnungsregel nur an einer
 * Stelle steht — die Regel selbst wird hier nicht zweitkodiert.
 */
function assertWritableVisit(match: X01Match, command: SubmitVisitCommand, before: X01MatchState): void {
  // Nur fuer das Kommando, das tatsaechlich an der Reihe ist. Sonst blieben
  // die aussagekraeftigeren Fehler der Projektion (NOT_ACTIVE_SEAT,
  // INVALID_THROWER, MATCH_ALREADY_COMPLETED) hinter diesen Regeln verborgen.
  if (before.activeSeat !== command.seat) return;
  if (before.activeThrowerPlayerId !== command.throwerPlayerId) return;
  validateVisit(command);
  const side = before.sides[indexOfSeat(command.seat)];
  // Double In: vor der Eroeffnung zaehlt die Aufnahme erst ab dem
  // eroeffnenden Doppel. Aus einer blossen Rundensumme laesst sich der Anteil
  // vor dem Doppel nicht rekonstruieren — die Engine rechnete die ganze Summe
  // an (501, S1/D20/S20 = 61 ergab Rest 440 statt 441). In diesem Zustand
  // sind Wurfdaten deshalb Pflicht.
  if (match.rules.inRule === "DOUBLE" && !side.openedInLeg && command.darts === undefined && command.points > 0) {
    throw new ScoringValidationError(
      "DARTS_REQUIRED_FOR_DOUBLE_IN",
      "Under double in the opening visit must be recorded dart by dart.",
    );
  }
  // Master Out: bringt die Aufnahme den Rest rechnerisch auf null, entscheidet
  // ohne Wurfdaten, ohne Segmentangabe und ohne `checkoutMissed` allein die
  // Heuristik `finishesOnMasterSegment` — und die raet permissiv (Rest 60 mit
  // drei Darts gilt ihr als Finish, obwohl S20/S20/S20 keins ist). Neue
  // Kommandos muessen den Abschluss deshalb belegen: `checkoutDouble` (nur
  // Doppel), `checkoutSegment` (Doppel oder Triple), Einzelwuerfe oder die
  // ausdrueckliche Meldung, dass keins sass.
  //
  // ACHTUNG Reihenfolge: `command.points` ist die ROHE Rundensumme, nicht die
  // nach der In-Regel angerechnete. Unter Double In vor der Eroeffnung liefen
  // die beiden auseinander — dort hat der Block oben das Kommando aber schon
  // abgelehnt, weil Wurfdaten Pflicht sind (und mit Wurfdaten greift diese
  // Regel nicht). Ist die Seite eroeffnet oder gilt Straight In, sind rohe
  // und angerechnete Summe gleich. Diese Regel darf deshalb nicht vor den
  // Double-In-Block wandern; der Test „MASTER + Double In, nicht eroeffnet"
  // haelt das fest.
  if (
    match.rules.outRule === "MASTER" &&
    command.darts === undefined &&
    command.checkoutDouble === undefined &&
    command.checkoutSegment === undefined &&
    command.checkoutMissed !== true &&
    side.remaining - command.points === 0
  ) {
    throw new ScoringValidationError(
      "CHECKOUT_DETAIL_REQUIRED",
      "Under master out a finishing visit needs the closing segment, the recorded darts or an explicit miss.",
    );
  }
}

export function executeX01Command(match: X01Match, command: X01Command): ExecuteX01Result {
  if (match.commands.some((existing) => existing.commandId === command.commandId)) {
    return { match, state: projectX01Match(match), duplicate: true, outcome: null };
  }
  if (command.type === "SUBMIT_VISIT") {
    assertWritableVisit(match, command, projectX01Match(match));
  }
  if (command.type === "UNDO_LAST_VISIT") {
    const active = activeCommands(match.commands);
    const latest = active.submissions.at(-1);
    if (latest === undefined) {
      throw new ScoringValidationError("NOTHING_TO_UNDO", "There is no active visit to undo.");
    }
    if (command.targetCommandId !== latest.commandId) {
      throw new ScoringValidationError("UNDO_TARGET_NOT_LATEST", "Only the latest active visit can be undone.");
    }
    if (active.stream.at(-1)?.type === "DECIDE_LEG_BY_BULL") {
      throw new ScoringValidationError(
        "UNDO_TARGET_NOT_LATEST",
        "The leg was decided by a bull throw; the visit before it cannot be undone.",
      );
    }
  }
  if (command.type === "DECIDE_LEG_START") {
    const current = projectX01Match(match);
    if (command.legNumber < current.legNumber) {
      throw new ScoringValidationError("LEG_ALREADY_PLAYED", "That leg is already played.");
    }
    if (
      command.legNumber === current.legNumber &&
      current.visits.some((applied) => applied.legNumber === current.legNumber)
    ) {
      throw new ScoringValidationError("LEG_ALREADY_STARTED", "The leg is already running.");
    }
  }
  const nextMatch: X01Match = { ...match, commands: [...match.commands, command] };
  const state = projectX01Match(nextMatch);
  return {
    match: nextMatch,
    state,
    duplicate: false,
    outcome: commandOutcome(command, state),
  };
}

function commandOutcome(
  command: X01Command,
  state: X01MatchState,
): VisitOutcome | "VISIT_UNDONE" | null {
  switch (command.type) {
    case "UNDO_LAST_VISIT":
      return "VISIT_UNDONE";
    case "DECIDE_LEG_START":
      return null;
    case "DECIDE_LEG_BY_BULL":
      return state.legDecisions.at(-1)?.outcome ?? null;
    case "SUBMIT_VISIT":
      return state.visits.at(-1)?.outcome ?? null;
  }
}
