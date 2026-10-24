import { BOARD_HEIGHT, BOARD_WIDTH, PIECE_CELLS, type Board, type PieceType, type Rotation } from '@line-battle/engine';

export const FULL_ROW = (1 << BOARD_WIDTH) - 1;

/**
 * A compact copy of the playfield for the search: one bitmask per row
 * (bit x = column x), so copying and testing boards is cheap.
 */
export class BotBoard {
  constructor(readonly rows: Uint16Array = new Uint16Array(BOARD_HEIGHT)) {}

  static from(board: Board): BotBoard {
    const b = new BotBoard();
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      let row = 0;
      for (let x = 0; x < BOARD_WIDTH; x++) if (board.get(x, y) !== 0) row |= 1 << x;
      b.rows[y] = row;
    }
    return b;
  }

  /** Builds a board from strings, top row first, ending at y = 0. Anything but '.' is filled. */
  static parse(lines: string[]): BotBoard {
    const b = new BotBoard();
    lines.forEach((line, i) => {
      const y = lines.length - 1 - i;
      for (let x = 0; x < BOARD_WIDTH; x++) if (line[x] && line[x] !== '.') b.rows[y] |= 1 << x;
    });
    return b;
  }

  clone(): BotBoard {
    return new BotBoard(this.rows.slice());
  }

  /** Walls, floor and the ceiling count as occupied, as in the engine. */
  occupied(x: number, y: number): boolean {
    if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) return true;
    return (this.rows[y] & (1 << x)) !== 0;
  }

  fits(type: PieceType, x: number, y: number, rot: Rotation): boolean {
    for (const [dx, dy] of PIECE_CELLS[type][rot]) {
      const cx = x + dx;
      const cy = y + dy;
      if (cx < 0 || cx >= BOARD_WIDTH || cy < 0 || cy >= BOARD_HEIGHT) return false;
      if ((this.rows[cy] & (1 << cx)) !== 0) return false;
    }
    return true;
  }

  /** Row the piece lands on when dropped straight down from y. */
  dropY(type: PieceType, x: number, y: number, rot: Rotation): number {
    while (this.fits(type, x, y - 1, rot)) y--;
    return y;
  }

  place(type: PieceType, x: number, y: number, rot: Rotation): void {
    for (const [dx, dy] of PIECE_CELLS[type][rot]) {
      this.rows[y + dy] |= 1 << (x + dx);
    }
  }

  /** Removes full rows and returns how many were cleared. */
  clearLines(): number {
    let write = 0;
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      const row = this.rows[y];
      if (row === FULL_ROW) continue;
      this.rows[write++] = row;
    }
    const cleared = BOARD_HEIGHT - write;
    this.rows.fill(0, write);
    return cleared;
  }

  isEmpty(): boolean {
    return this.rows.every((r) => r === 0);
  }

  /** Height of each column: one above its highest filled cell, 0 when empty. */
  heights(out: number[] = new Array(BOARD_WIDTH)): number[] {
    for (let x = 0; x < BOARD_WIDTH; x++) out[x] = 0;
    let left = FULL_ROW;
    for (let y = BOARD_HEIGHT - 1; y >= 0 && left; y--) {
      const hit = this.rows[y] & left;
      if (!hit) continue;
      for (let x = 0; x < BOARD_WIDTH; x++) if (hit & (1 << x)) out[x] = y + 1;
      left &= ~hit;
    }
    return out;
  }
}
