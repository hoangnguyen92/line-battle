import { PIECE_TYPES, type PieceType } from './pieces';
import { Rng } from './rng';

/** 7-bag randomizer: every run of 7 pieces holds each piece exactly once. */
export class Bag {
  private rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  nextBag(): PieceType[] {
    const bag = [...PIECE_TYPES];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }
}
