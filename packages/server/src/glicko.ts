/**
 * Glicko-2 ratings (Glickman, "Example of the Glicko-2 system"). Each ranked
 * match is its own rating period with one result, so a rating moves right
 * after every match; time spent away still widens the deviation, through
 * idle periods that are counted in days.
 */

export interface Rating {
  /** Shown to players, centred on 1500. */
  rating: number;
  /** Rating deviation: how unsure the rating is. 350 for a new player. */
  rd: number;
  /** Volatility: how erratic the player's results are. */
  vol: number;
}

export const DEFAULT_RATING: Readonly<Rating> = { rating: 1500, rd: 350, vol: 0.06 };
/** Constrains how fast volatility changes; the paper suggests 0.3-1.2. */
export const TAU = 0.5;
/** A deviation never shrinks below this, so a rating can always move. */
export const MIN_RD = 45;
/** One idle period per day away. */
export const PERIOD_MS = 24 * 60 * 60 * 1000;

const SCALE = 173.7178;
const EPSILON = 0.000001;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** The deviation after `periods` rating periods with no games. */
export function idleRd(r: Rating, periods: number): number {
  if (periods <= 0) return r.rd;
  const phi = r.rd / SCALE;
  const grown = Math.sqrt(phi * phi + periods * r.vol * r.vol) * SCALE;
  return Math.min(DEFAULT_RATING.rd, grown);
}

/** Chance that `a` beats `b`, from their ratings. */
export function winChance(a: Rating, b: Rating): number {
  const phiB = b.rd / SCALE;
  return expected((a.rating - 1500) / SCALE, (b.rating - 1500) / SCALE, phiB);
}

export interface Result {
  opp: Rating;
  /** 1 for a win, 0 for a loss, 0.5 for a draw. */
  score: number;
}

/**
 * One rating period for player `p`, with its results against opponents as
 * they stood before the period (a ranked match is one result).
 */
export function rate(p: Rating, results: readonly Result[]): Rating {
  const mu = (p.rating - 1500) / SCALE;
  const phi = p.rd / SCALE;
  if (results.length === 0) return { ...p, rd: idleRd(p, 1) };

  let vInv = 0;
  let sum = 0;
  for (const { opp, score } of results) {
    const muJ = (opp.rating - 1500) / SCALE;
    const phiJ = opp.rd / SCALE;
    const gJ = g(phiJ);
    const e = expected(mu, muJ, phiJ);
    vInv += gJ * gJ * e * (1 - e);
    sum += gJ * (score - e);
  }
  const v = 1 / vInv;
  const delta = v * sum;

  // New volatility: solve f(x) = 0 with the Illinois method (step 5 of the paper).
  const a = Math.log(p.vol * p.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > EPSILON; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const vol = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * sum;
  return { rating: muNew * SCALE + 1500, rd: phiNew * SCALE, vol };
}

/** `rate` with the game's limits: the deviation stays between MIN_RD and 350. */
export function rateMatch(p: Rating, opp: Rating, score: number): Rating {
  const r = rate(p, [{ opp, score }]);
  return { ...r, rd: Math.max(MIN_RD, Math.min(DEFAULT_RATING.rd, r.rd)) };
}
