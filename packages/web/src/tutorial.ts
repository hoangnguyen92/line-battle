import { BOARD_HEIGHT, BOARD_WIDTH, Game, randomSeed, type GameEvent, type Key, type KeyMap } from '@line-battle/engine';
import { keysText } from './input';

/** Garbage cell value on the board. */
const GARBAGE = 8;

interface Lesson {
  title: string;
  text(keys: KeyMap): string;
  /** Sets the board up for this lesson, if it needs a particular one. */
  setup?(game: Game): void;
  /** Keys pressed and events seen so far in this lesson; true when it's done. */
  done(pressed: Set<Key>, events: GameEvent[]): boolean;
  /** True when the board can no longer be solved, so it's set up again. */
  stuck?(game: Game): boolean;
}

/** The gap in column `hole` is covered: something sits above an empty cell of it. */
function covered(game: Game, rows: number, hole: number): boolean {
  let empty = false;
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    if (y < rows && game.board.get(hole, y) === 0) empty = true;
    else if (empty && game.board.get(hole, y) !== 0) return true;
  }
  return false;
}

/** Empties the board, then fills the bottom `rows` rows except column `hole`. */
function well(game: Game, rows: number, hole: number): void {
  for (let y = 0; y < BOARD_HEIGHT; y++) for (let x = 0; x < BOARD_WIDTH; x++) game.board.set(x, y, 0);
  for (let y = 0; y < rows; y++) for (let x = 0; x < BOARD_WIDTH; x++) game.board.set(x, y, x === hole ? 0 : GARBAGE);
}

const LESSONS: Lesson[] = [
  {
    title: 'Move',
    text: (k) => `Move the falling piece left and right with ${keysText(k.left)} and ${keysText(k.right)}.`,
    done: (p) => p.has('left') && p.has('right'),
  },
  {
    title: 'Rotate',
    text: (k) => `Turn it clockwise with ${keysText(k.rotateCW)}, and the other way with ${keysText(k.rotateCCW)}.`,
    done: (p) => p.has('rotateCW') && p.has('rotateCCW'),
  },
  {
    title: 'Drop',
    text: (k) => `Hold ${keysText(k.softDrop)} to drop faster, or press ${keysText(k.hardDrop)} to drop it all the way at once.`,
    done: (p, ev) => p.has('hardDrop') && ev.some((e) => e.type === 'lock'),
  },
  {
    title: 'Hold',
    text: (k) => `Press ${keysText(k.hold)} to put a piece aside for later. Press it again to swap it back.`,
    done: (_p, ev) => ev.some((e) => e.type === 'hold'),
  },
  {
    title: 'Clear a line',
    text: () => 'Fill the gap on the right to complete the row. Full rows disappear.',
    setup: (g) => well(g, 1, 9),
    done: (_p, ev) => ev.some((e) => e.type === 'clear'),
    stuck: (g) => covered(g, 1, 9),
  },
  {
    title: 'Clear four at once',
    text: (k) => `Clearing 4 rows with one long I piece is a Quad: it sends 4 lines of garbage in a match. Use ${keysText(k.hold)} to save an I piece if it helps.`,
    setup: (g) => well(g, 4, 9),
    done: (_p, ev) => ev.some((e) => e.type === 'clear' && e.info.lines >= 4),
    // A smaller clear also spoils the 4-row gap.
    stuck: (g) => covered(g, 4, 9) || g.board.get(0, 3) !== GARBAGE,
  },
];

/**
 * A short guided game: each lesson asks for one thing and moves on once it
 * happens. The last screen explains versus play and offers the first bot.
 */
export class Tutorial {
  readonly game: Game;
  lesson = 0;
  private pressed = new Set<Key>();
  private seen: GameEvent[] = [];

  /** `start` picks up at a later lesson, e.g. after topping out. */
  constructor(start = 0) {
    // Slow gravity, endless: nobody should top out while reading.
    this.game = new Game({ seed: randomSeed(), gravity: 600 });
    this.lesson = Math.min(start, LESSONS.length);
    if (!this.finished) LESSONS[this.lesson].setup?.(this.game);
  }

  get count(): number {
    return LESSONS.length;
  }

  get finished(): boolean {
    return this.lesson >= LESSONS.length;
  }

  title(): string {
    return this.finished ? 'Ready for a match' : LESSONS[this.lesson].title;
  }

  text(keys: KeyMap): string {
    if (this.finished) {
      return 'In a match, every clear sends garbage to your opponent, and bigger clears, combos and T-spins send more. Your clears cancel garbage coming at you first. Top out and you lose the round.';
    }
    return LESSONS[this.lesson].text(keys);
  }

  /**
   * Feeds one tick's key presses and the game's events. Returns 'done' when
   * a lesson was just completed, 'retry' when its board was set up again.
   */
  update(presses: Key[], events: GameEvent[]): 'done' | 'retry' | null {
    if (this.finished) return null;
    const lesson = LESSONS[this.lesson];
    for (const k of presses) this.pressed.add(k);
    this.seen.push(...events);
    if (!lesson.done(this.pressed, this.seen)) {
      if (!events.some((e) => e.type === 'lock') || !lesson.stuck?.(this.game)) return null;
      lesson.setup?.(this.game);
      return 'retry';
    }
    this.lesson++;
    this.pressed.clear();
    this.seen = [];
    if (!this.finished) LESSONS[this.lesson].setup?.(this.game);
    return 'done';
  }
}
