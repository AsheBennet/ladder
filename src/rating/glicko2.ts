/** Glicko-2 (Glickman) — μ/φ/σ; rating displayed as μ. */

export type Rating = { mu: number; phi: number; sigma: number };

export const DEFAULT_RATING: Rating = { mu: 1500, phi: 350, sigma: 0.06 };

const TAU = 0.5;
const EPSILON = 1e-6;
const SCALE = 173.7178;

function toGlicko2(r: Rating) {
  return { mu: (r.mu - 1500) / SCALE, phi: r.phi / SCALE, sigma: r.sigma };
}

function fromGlicko2(mu: number, phi: number, sigma: number): Rating {
  return { mu: mu * SCALE + 1500, phi: phi * SCALE, sigma };
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function E(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/** Update player rating given one opponent and score (1 win, 0 loss, 0.5 draw). */
export function updateRating(player: Rating, opponent: Rating, score: number): Rating {
  const p = toGlicko2(player);
  const o = toGlicko2(opponent);
  const gPhi = g(o.phi);
  const e = E(p.mu, o.mu, o.phi);
  const v = 1 / (gPhi * gPhi * e * (1 - e));
  const delta = v * gPhi * (score - e);

  const a = Math.log(p.sigma * p.sigma);
  const phiSq = p.phi * p.phi;
  const f = (x: number) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phiSq - v - ex);
    const den = 2 * (phiSq + v + ex) * (phiSq + v + ex);
    return num / den - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B: number;
  if (delta * delta > phiSq + v) {
    B = Math.log(delta * delta - phiSq - v);
  } else {
    let k = 1;
    B = a - k * TAU;
    while (f(B) < 0) {
      k += 1;
      B = a - k * TAU;
    }
  }

  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  const sigmaPrime = Math.exp(A / 2);
  const phiStar = Math.sqrt(phiSq + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = p.mu + phiPrime * phiPrime * gPhi * (score - e);
  return fromGlicko2(muPrime, phiPrime, sigmaPrime);
}

export function pairUpdate(
  a: Rating,
  b: Rating,
  aWon: boolean,
): { a: Rating; b: Rating } {
  return {
    a: updateRating(a, b, aWon ? 1 : 0),
    b: updateRating(b, a, aWon ? 0 : 1),
  };
}
