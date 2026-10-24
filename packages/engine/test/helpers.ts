import { Game, type GameConfig, type Key, type KeyEvent } from '../src';

/** Fills the board from strings, top row first, ending at y = 0. 'X' = filled. */
export function setRows(game: Game, rows: string[]): void {
  game.board.cells.fill(0);
  rows.forEach((row, i) => {
    const y = rows.length - 1 - i;
    [...row].forEach((ch, x) => ch !== '.' && game.board.set(x, y, 8));
  });
}

/** A test game; entry delay is off unless a test asks for it, so pieces spawn at once. */
export function newGame(config: Partial<GameConfig> = {}): Game {
  return new Game({ seed: 1, entryDelay: 0, ...config });
}

export const press = (key: Key): KeyEvent => ({ key, down: true });
export const release = (key: Key): KeyEvent => ({ key, down: false });

/** Taps a key: down this tick, up the next. */
export function tap(game: Game, key: Key): void {
  game.step([press(key)]);
  game.step([release(key)]);
}

export function stepN(game: Game, n: number, events: KeyEvent[] = []): void {
  for (let i = 0; i < n; i++) game.step(i === 0 ? events : []);
}
