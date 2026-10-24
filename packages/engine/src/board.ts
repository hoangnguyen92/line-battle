export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 40;
export const VISIBLE_HEIGHT = 20;

/** The playfield. y = 0 is the bottom row; rows 20-39 are hidden buffer. */
export class Board {
  readonly cells = new Uint8Array(BOARD_WIDTH * BOARD_HEIGHT);

  get(x: number, y: number): number {
    return this.cells[y * BOARD_WIDTH + x];
  }

  set(x: number, y: number, v: number): void {
    this.cells[y * BOARD_WIDTH + x] = v;
  }

  /** Walls, floor and filled cells all count as occupied. */
  occupied(x: number, y: number): boolean {
    if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) return true;
    return this.get(x, y) !== 0;
  }

  /** Removes full rows, drops the rows above, and returns how many were cleared. */
  clearLines(): number {
    let write = 0;
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      const row = this.cells.subarray(y * BOARD_WIDTH, (y + 1) * BOARD_WIDTH);
      if (row.every((v) => v !== 0)) continue;
      if (write !== y) this.cells.copyWithin(write * BOARD_WIDTH, y * BOARD_WIDTH, (y + 1) * BOARD_WIDTH);
      write++;
    }
    this.cells.fill(0, write * BOARD_WIDTH);
    return BOARD_HEIGHT - write;
  }

  isEmpty(): boolean {
    return this.cells.every((v) => v === 0);
  }
}
