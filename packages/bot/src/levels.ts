import { DEFAULT_WEIGHTS, type Weights } from './evaluate';

export type LevelId = 1 | 2 | 3 | 4 | 5;

export interface BotLevel {
  id: LevelId;
  name: string;
  /** Target pieces per second: the main difficulty knob. */
  pps: number;
  /** Ticks between taps, so lower levels visibly move the piece. */
  inputGap: number;
  /** Pieces the search plans for, counting the current one. */
  lookahead: number;
  /** Boards kept at each step of the beam search. */
  beamWidth: number;
  useHold: boolean;
  /** Chance per piece to pick a worse spot on purpose. */
  mistakeRate: number;
  /** A mistake picks one of the next this-many best spots. */
  mistakeRange: number;
  weights: Weights;
}

/** No T-spin setups or spin bonuses: the bot only stacks flat and clears lines. */
const NO_SPINS: Weights = {
  ...DEFAULT_WEIGHTS,
  tSlot: [0, 0, 0, 0],
  tSpin: [0, -143, -100, -58],
  tSpinMini: [0, -143, -100],
  wastedT: 0,
};

/** Spins only up to T-spin doubles; triples are not set up. */
const TSD_ONLY: Weights = { ...DEFAULT_WEIGHTS, tSpin: [0, 121, 410, 410] };

export const LEVELS: Record<LevelId, BotLevel> = {
  1: {
    id: 1, name: 'Beginner', pps: 0.8, inputGap: 9, lookahead: 1, beamWidth: 1, useHold: false,
    mistakeRate: 0.2, mistakeRange: 4, weights: NO_SPINS,
  },
  2: {
    id: 2, name: 'Casual', pps: 1.3, inputGap: 6, lookahead: 2, beamWidth: 6, useHold: true,
    mistakeRate: 0.12, mistakeRange: 4, weights: NO_SPINS,
  },
  3: {
    id: 3, name: 'Intermediate', pps: 2.0, inputGap: 4, lookahead: 3, beamWidth: 12, useHold: true,
    mistakeRate: 0.04, mistakeRange: 3, weights: TSD_ONLY,
  },
  4: {
    id: 4, name: 'Advanced', pps: 3.0, inputGap: 2, lookahead: 4, beamWidth: 16, useHold: true,
    mistakeRate: 0.01, mistakeRange: 2, weights: DEFAULT_WEIGHTS,
  },
  5: {
    id: 5, name: 'Expert', pps: 4.0, inputGap: 1, lookahead: 6, beamWidth: 48, useHold: true,
    mistakeRate: 0, mistakeRange: 1, weights: DEFAULT_WEIGHTS,
  },
};

export const LEVEL_IDS: readonly LevelId[] = [1, 2, 3, 4, 5];
