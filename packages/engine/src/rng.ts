/**
 * Seeded xorshift32 PRNG. Integer-only so every platform produces the same
 * sequence for the same seed, which keeps replays and versus matches in sync.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    // xorshift has a fixed point at 0, so swap a zero seed for a constant.
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return this.next() % n;
  }
}

/** A fresh random seed for a new game (not used inside the simulation). */
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}
