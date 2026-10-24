export type PieceType = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z';

/** Rotation states: 0 = spawn, 1 = R (clockwise), 2 = 180, 3 = L. */
export type Rotation = 0 | 1 | 2 | 3;

export const PIECE_TYPES: readonly PieceType[] = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

/** Cell values stored on the board: 0 is empty. */
export const CELL_ID: Record<PieceType, number> = { I: 1, J: 2, L: 3, O: 4, S: 5, T: 6, Z: 7 };
export const GARBAGE_CELL = 8;

// Spawn-orientation shapes inside their SRS bounding boxes, top row first.
const SHAPES: Record<PieceType, string[]> = {
  I: ['....', 'IIII', '....', '....'],
  J: ['J..', 'JJJ', '...'],
  L: ['..L', 'LLL', '...'],
  O: ['OO', 'OO'],
  S: ['.SS', 'SS.', '...'],
  T: ['.T.', 'TTT', '...'],
  Z: ['ZZ.', '.ZZ', '...'],
};

/** [dx, dy] offsets from the box's top-left corner, y pointing up (so dy <= 0). */
export type Cell = readonly [number, number];

function rotateCW(m: string[][]): string[][] {
  const n = m.length;
  return m.map((_, r) => m.map((__, c) => m[n - 1 - c][r]));
}

function buildCells(type: PieceType): Cell[][] {
  let m = SHAPES[type].map((row) => row.split(''));
  const states: Cell[][] = [];
  for (let rot = 0; rot < 4; rot++) {
    const cells: Cell[] = [];
    m.forEach((row, r) => row.forEach((ch, c) => ch !== '.' && cells.push([c, -r])));
    states.push(cells);
    m = rotateCW(m);
  }
  return states;
}

export const PIECE_CELLS: Record<PieceType, Cell[][]> = Object.fromEntries(
  PIECE_TYPES.map((t) => [t, buildCells(t)]),
) as Record<PieceType, Cell[][]>;

export const BOX_SIZE: Record<PieceType, number> = Object.fromEntries(
  PIECE_TYPES.map((t) => [t, SHAPES[t].length]),
) as Record<PieceType, number>;
