import { attackFor } from './attack';
import { Bag } from './bag';
import { Board, BOARD_WIDTH, VISIBLE_HEIGHT } from './board';
import { CELL_ID, GARBAGE_CELL, PIECE_CELLS, type PieceType, type Rotation } from './pieces';
import { Rng } from './rng';
import { getKicks } from './srs';

/** The simulation runs at a fixed 60 ticks per second. */
export const TICK_RATE = 60;

/** Fixed-point unit for gravity: 65536 = one row per tick (1G). */
export const G = 65536;

/** A soft drop factor at or above this value drops the piece instantly. */
export const SDF_INSTANT = 41;

export interface Handling {
  /** Delayed auto shift, in ticks (8 = ~133 ms). */
  das: number;
  /** Auto repeat rate, in ticks per move; 0 moves straight to the wall. */
  arr: number;
  /** Soft drop factor: SDF/20 rows per tick, SDF_INSTANT = instant. */
  sdf: number;
}

export const DEFAULT_HANDLING: Handling = { das: 10, arr: 3, sdf: 6 };

export interface GameConfig {
  seed: number;
  handling?: Handling;
  /** Gravity in G/65536 rows per tick. Default 0.02G. */
  gravity?: number;
  /** Lock delay in ticks. Default 30 (500 ms). */
  lockDelay?: number;
  /** Moves or rotations on the ground that reset the lock delay. Default 15. */
  maxLockResets?: number;
  /**
   * Ticks between a piece locking and the next one appearing. Default 6 (100 ms).
   * Presses during this gap are ignored, so a hard drop can't spill into the next piece.
   */
  entryDelay?: number;
  /** Pieces shown in the next queue. Default 5. */
  previewCount?: number;
  /** Lines needed to finish (40 for sprint). Undefined = endless. */
  goalLines?: number;
  /** Ticks received garbage waits before it can rise. Default 20 (~330 ms). */
  garbageDelay?: number;
  /** Most garbage lines that rise on one lock. Default 8. */
  garbageCap?: number;
  /** Percent chance that a new attack's hole is in a different column. Default 30. */
  garbageMessiness?: number;
  /** Seeds where garbage holes go. Default: derived from `seed` (see garbageSeed). */
  garbageSeed?: number;
  /**
   * 'perLine' (default) gives every garbage line its own random hole.
   * 'perAttack' lines up the holes of one attack in a column, as before
   * replay version 2; garbageMessiness only applies to this mode.
   */
  garbageHoles?: 'perLine' | 'perAttack';
}

/**
 * The garbage hole seed for a board. In a match each player gets their own
 * (`player` 0 or 1), so the two boards share pieces but not holes; `null` is
 * the single shared sequence that solo games and older replays use.
 */
export function garbageSeed(seed: number, player: 0 | 1 | null): number {
  const shared = (seed ^ 0x5bd1e995) >>> 0;
  return player === null ? shared : (shared ^ Math.imul(player + 1, 0x9e3779b9)) >>> 0;
}

/** Garbage waiting to rise: one entry per received attack. */
export interface PendingGarbage {
  lines: number;
  /** Column of the hole that every line of this attack shares; -1 for 'perLine' holes. */
  hole: number;
  /** First tick this garbage may rise. */
  readyTick: number;
}

export type Key = 'left' | 'right' | 'softDrop' | 'hardDrop' | 'rotateCW' | 'rotateCCW' | 'rotate180' | 'hold';

export const KEYS: readonly Key[] = ['left', 'right', 'softDrop', 'hardDrop', 'rotateCW', 'rotateCCW', 'rotate180', 'hold'];

export interface KeyEvent {
  key: Key;
  down: boolean;
}

export interface ActivePiece {
  type: PieceType;
  x: number;
  /** Row of the bounding box's top edge (y up). */
  y: number;
  rot: Rotation;
}

export type TopOutReason = 'blockOut' | 'lockOut' | 'garbageOut';

export type SpinKind = 'none' | 'mini' | 'full';

export interface ClearInfo {
  piece: PieceType;
  lines: number;
  spin: SpinKind;
  perfectClear: boolean;
  /** Back-to-back chain length; 1 or more means this clear got a B2B bonus. */
  b2b: number;
  /** Combo counter: 0 for the first clear in a row, then 1, 2, ... */
  combo: number;
  /** Lines this clear attacks with, before cancelling. */
  attack: number;
  tick: number;
}

export interface AttackInfo {
  /** Lines the clear produced, before cancelling (picks the hit animation). */
  raw: number;
  /** Lines used to cancel garbage waiting for this player. */
  cancelled: number;
  /** Lines that go on to the opponent. */
  sent: number;
  tick: number;
}

export type GameEvent =
  | { type: 'lock'; piece: PieceType; tick: number }
  | { type: 'clear'; info: ClearInfo }
  | { type: 'attack'; info: AttackInfo }
  | { type: 'garbage'; lines: number; tick: number }
  | { type: 'hold'; piece: PieceType }
  | { type: 'topOut'; reason: TopOutReason; tick: number }
  | { type: 'finish'; tick: number };

const SPAWN_X: Record<PieceType, number> = { I: 3, J: 3, L: 3, O: 4, S: 3, T: 3, Z: 3 };
const SPAWN_TOP = VISIBLE_HEIGHT + 1;

/**
 * A deterministic single-board game. Feed it key events once per tick with
 * step(); the same seed and the same events always produce the same game.
 */
export class Game {
  readonly board = new Board();
  readonly config: Required<Omit<GameConfig, 'goalLines'>> & { goalLines?: number };

  active: ActivePiece | null = null;
  hold: PieceType | null = null;
  holdUsed = false;
  tick = 0;
  lines = 0;
  piecesPlaced = 0;
  /** -1 when no chain; see ClearInfo.b2b. */
  b2b = -1;
  /** -1 when no combo; see ClearInfo.combo. */
  combo = -1;
  toppedOut = false;
  finished = false;
  /** Garbage waiting to rise, oldest first. */
  incoming: PendingGarbage[] = [];
  /** Lines sent to the opponent after cancelling. */
  attackSent = 0;
  /** Garbage lines that have risen into this board. */
  garbageReceived = 0;

  private bag: Bag;
  private garbageRng: Rng;
  private lastHole = -1;
  private upcoming: PieceType[] = [];
  private events: GameEvent[] = [];

  private keys: Record<Key, boolean> = {
    left: false, right: false, softDrop: false, hardDrop: false,
    rotateCW: false, rotateCCW: false, rotate180: false, hold: false,
  };
  private shiftDir: -1 | 0 | 1 = 0;
  private dasTimer = 0;
  private arrTimer = 0;
  private gravityAcc = 0;
  private lockTimer = 0;
  private lockResets = 0;
  private lowestY = 0;
  private lastWasRotation = false;
  private lastKick = 0;
  /** Ticks left before the next piece spawns; 0 when a piece is in play. */
  private entryTimer = 0;

  constructor(config: GameConfig) {
    this.config = {
      handling: DEFAULT_HANDLING,
      gravity: Math.round(0.02 * G),
      lockDelay: 30,
      maxLockResets: 15,
      entryDelay: 6,
      previewCount: 5,
      garbageDelay: 20,
      garbageCap: 8,
      garbageMessiness: 30,
      garbageSeed: garbageSeed(config.seed, null),
      garbageHoles: 'perLine',
      ...config,
    };
    this.bag = new Bag(config.seed);
    this.garbageRng = new Rng(this.config.garbageSeed);
    this.spawn(this.takeNext());
  }

  get over(): boolean {
    return this.toppedOut || this.finished;
  }

  /** The next pieces, nearest first. */
  get queue(): PieceType[] {
    this.fillQueue();
    return this.upcoming.slice(0, this.config.previewCount);
  }

  /** Total lines waiting to rise. */
  get incomingLines(): number {
    return this.incoming.reduce((n, g) => n + g.lines, 0);
  }

  /**
   * Queues an attack from the opponent. It can rise once garbageDelay ticks
   * have passed, on the next lock that clears nothing.
   */
  receiveGarbage(lines: number): void {
    if (lines <= 0 || this.over) return;
    const readyTick = this.tick + this.config.garbageDelay;
    if (this.config.garbageHoles === 'perLine') {
      this.incoming.push({ lines, hole: -1, readyTick });
      return;
    }
    const { garbageRng: rng } = this;
    let hole = this.lastHole;
    if (hole < 0) {
      hole = rng.int(BOARD_WIDTH);
    } else if (rng.int(100) < this.config.garbageMessiness) {
      hole = (hole + 1 + rng.int(BOARD_WIDTH - 1)) % BOARD_WIDTH;
    }
    this.lastHole = hole;
    this.incoming.push({ lines, hole, readyTick });
  }

  /** Returns and clears the events produced since the last call. */
  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Cells of the active piece in board coordinates. */
  pieceCells(p: ActivePiece | null = this.active): [number, number][] {
    if (!p) return [];
    return PIECE_CELLS[p.type][p.rot].map(([dx, dy]) => [p.x + dx, p.y + dy]);
  }

  /** Where the active piece would land if hard dropped. */
  ghost(): ActivePiece | null {
    if (!this.active) return null;
    const g = { ...this.active };
    while (this.fits(g.type, g.x, g.y - 1, g.rot)) g.y--;
    return g;
  }

  /** Advances the game by one tick, applying the key events first. */
  step(events: readonly KeyEvent[] = []): void {
    if (this.over) return;
    this.applyTick(events);
    this.tick++;
  }

  private applyTick(events: readonly KeyEvent[]): void {
    if (this.entryTimer > 0) return this.waitForEntry(events);
    let pressedShift = false;
    for (const e of events) {
      if (this.over) return;
      if (this.keys[e.key] === e.down) continue;
      this.keys[e.key] = e.down;
      if (e.key === 'left' || e.key === 'right') {
        pressedShift = this.onShiftKey(e.key, e.down) || pressedShift;
      } else if (e.down) {
        this.onPress(e.key);
      }
    }
    if (this.over) return;

    if (!pressedShift) this.autoShift();
    this.applyGravity();
    this.updateLock();
  }

  /** Between pieces: track which keys are held, but no press takes effect. */
  private waitForEntry(events: readonly KeyEvent[]): void {
    for (const e of events) {
      if (this.keys[e.key] === e.down) continue;
      this.keys[e.key] = e.down;
      if (e.key === 'left' || e.key === 'right') this.onShiftKey(e.key, e.down);
    }
    // DAS keeps charging between pieces, and stays charged into the next one.
    if (this.shiftDir !== 0 && this.dasTimer < this.config.handling.das) this.dasTimer++;
    if (--this.entryTimer > 0) return;
    this.arrTimer = 0;
    this.spawn(this.takeNext());
    // A direction held with DAS charged slides the new piece straight away.
    if (this.active && this.shiftDir !== 0 && this.dasTimer >= this.config.handling.das) {
      if (this.config.handling.arr === 0) this.shiftToWall();
      else this.tryMove(this.shiftDir, 0);
    }
  }

  // ---- input -------------------------------------------------------------

  /** Returns true when this event started a new shift (so DAS skips this tick). */
  private onShiftKey(key: 'left' | 'right', down: boolean): boolean {
    const dir = key === 'left' ? -1 : 1;
    if (down) {
      this.shiftDir = dir;
      this.dasTimer = 0;
      this.arrTimer = 0;
      this.tryMove(dir, 0);
      return true;
    }
    if (this.shiftDir === dir) {
      // Fall back to the other direction if it is still held.
      const other = key === 'left' ? 'right' : 'left';
      this.shiftDir = this.keys[other] ? (-dir as -1 | 1) : 0;
      this.dasTimer = 0;
      this.arrTimer = 0;
    }
    return false;
  }

  private onPress(key: Key): void {
    switch (key) {
      case 'rotateCW': return void this.rotate(1);
      case 'rotateCCW': return void this.rotate(3);
      case 'rotate180': return void this.rotate(2);
      case 'hardDrop': return this.hardDrop();
      case 'hold': return this.doHold();
      case 'softDrop':
        if (this.config.handling.sdf >= SDF_INSTANT) this.sonicDrop();
        return;
      default:
        return;
    }
  }

  private autoShift(): void {
    if (this.shiftDir === 0 || !this.active) return;
    const { das, arr } = this.config.handling;
    if (this.dasTimer < das) {
      this.dasTimer++;
      if (this.dasTimer < das) return;
      this.arrTimer = 0;
      if (arr === 0) this.shiftToWall();
      else this.tryMove(this.shiftDir, 0);
      return;
    }
    if (arr === 0) {
      this.shiftToWall();
    } else if (++this.arrTimer >= arr) {
      this.arrTimer = 0;
      this.tryMove(this.shiftDir, 0);
    }
  }

  private shiftToWall(): void {
    while (this.tryMove(this.shiftDir, 0)) { /* keep sliding */ }
  }

  // ---- movement ----------------------------------------------------------

  private fits(type: PieceType, x: number, y: number, rot: Rotation): boolean {
    for (const [dx, dy] of PIECE_CELLS[type][rot]) {
      if (this.board.occupied(x + dx, y + dy)) return false;
    }
    return true;
  }

  private onGround(): boolean {
    const p = this.active;
    return !!p && !this.fits(p.type, p.x, p.y - 1, p.rot);
  }

  private tryMove(dx: number, dy: number): boolean {
    const p = this.active;
    if (!p || !this.fits(p.type, p.x + dx, p.y + dy, p.rot)) return false;
    const wasGrounded = this.onGround();
    p.x += dx;
    p.y += dy;
    this.lastWasRotation = false;
    if (dy < 0) this.onFall();
    else this.onManipulate(wasGrounded);
    return true;
  }

  private rotate(turn: 1 | 2 | 3): boolean {
    const p = this.active;
    if (!p) return false;
    const to = ((p.rot + turn) % 4) as Rotation;
    const kicks = getKicks(p.type, p.rot, to);
    const wasGrounded = this.onGround();
    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      if (this.fits(p.type, p.x + kx, p.y + ky, to)) {
        p.x += kx;
        p.y += ky;
        p.rot = to;
        this.lastWasRotation = true;
        this.lastKick = i;
        if (p.y < this.lowestY) this.onFall();
        this.onManipulate(wasGrounded);
        return true;
      }
    }
    return false;
  }

  /** A successful move or rotation: resets the lock delay while resets remain. */
  private onManipulate(wasGrounded: boolean): void {
    if (!wasGrounded && !this.onGround()) return;
    this.lockResets++;
    if (this.lockResets <= this.config.maxLockResets) this.lockTimer = 0;
  }

  /** The piece reached a new lowest row: the lock delay and its resets start over. */
  private onFall(): void {
    const p = this.active!;
    if (p.y < this.lowestY) {
      this.lowestY = p.y;
      this.lockTimer = 0;
      this.lockResets = 0;
    }
  }

  private sonicDrop(): void {
    while (this.tryMove(0, -1)) { /* fall */ }
  }

  private hardDrop(): void {
    if (!this.active) return;
    this.sonicDrop();
    this.lock();
  }

  private applyGravity(): void {
    if (!this.active) return;
    const { gravity, handling } = this.config;
    let rate = gravity;
    if (this.keys.softDrop) {
      if (handling.sdf >= SDF_INSTANT) return this.sonicDrop();
      rate = Math.max(gravity, Math.floor((handling.sdf * G) / 20));
    }
    if (this.onGround()) {
      this.gravityAcc = 0;
      return;
    }
    this.gravityAcc += rate;
    while (this.gravityAcc >= G) {
      this.gravityAcc -= G;
      if (!this.tryMove(0, -1)) {
        this.gravityAcc = 0;
        break;
      }
    }
  }

  private updateLock(): void {
    if (!this.active || !this.onGround()) return;
    this.lockTimer++;
    if (this.lockTimer >= this.config.lockDelay || this.lockResets > this.config.maxLockResets) {
      this.lock();
    }
  }

  // ---- pieces ------------------------------------------------------------

  private fillQueue(): void {
    while (this.upcoming.length < this.config.previewCount + 1) {
      this.upcoming.push(...this.bag.nextBag());
    }
  }

  private takeNext(): PieceType {
    this.fillQueue();
    return this.upcoming.shift()!;
  }

  private spawn(type: PieceType): void {
    const p: ActivePiece = { type, x: SPAWN_X[type], y: SPAWN_TOP, rot: 0 };
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lastWasRotation = false;
    this.lowestY = p.y;
    if (!this.fits(type, p.x, p.y, 0)) {
      this.active = null;
      this.topOut('blockOut');
      return;
    }
    this.active = p;
  }

  private doHold(): void {
    if (!this.active || this.holdUsed) return;
    const current = this.active.type;
    const next = this.hold ?? this.takeNext();
    this.hold = current;
    this.holdUsed = true;
    this.events.push({ type: 'hold', piece: current });
    this.spawn(next);
  }

  private topOut(reason: TopOutReason): void {
    this.toppedOut = true;
    this.events.push({ type: 'topOut', reason, tick: this.tick });
  }

  /** 3-corner T-spin check, done before lines are removed. */
  private detectSpin(p: ActivePiece): SpinKind {
    if (p.type !== 'T' || !this.lastWasRotation) return 'none';
    const cx = p.x + 1;
    const cy = p.y - 1;
    // Corners in clockwise order from top-left: TL, TR, BR, BL.
    const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => this.board.occupied(cx + dx, cy + dy));
    const filled = corners.filter(Boolean).length;
    if (filled < 3) return 'none';
    // The two corners on the side the T points to.
    const front = [corners[p.rot], corners[(p.rot + 1) % 4]];
    if (front[0] && front[1]) return 'full';
    return this.lastKick === 4 ? 'full' : 'mini';
  }

  private lock(): void {
    const p = this.active;
    if (!p) return;
    const cells = this.pieceCells(p);
    const spin = this.detectSpin(p);
    for (const [x, y] of cells) this.board.set(x, y, CELL_ID[p.type]);
    this.active = null;
    this.piecesPlaced++;
    this.events.push({ type: 'lock', piece: p.type, tick: this.tick });

    if (cells.every(([, y]) => y >= VISIBLE_HEIGHT)) {
      this.topOut('lockOut');
      return;
    }

    const lines = this.board.clearLines();
    if (lines > 0) {
      const difficult = lines === 4 || spin !== 'none';
      this.b2b = difficult ? this.b2b + 1 : -1;
      this.combo++;
    } else {
      this.combo = -1;
    }
    if (lines > 0 || spin !== 'none') {
      const info: ClearInfo = {
        piece: p.type,
        lines,
        spin,
        perfectClear: lines > 0 && this.board.isEmpty(),
        b2b: lines > 0 ? Math.max(this.b2b, 0) : 0,
        combo: Math.max(this.combo, 0),
        attack: 0,
        tick: this.tick,
      };
      info.attack = attackFor(info).total;
      this.events.push({ type: 'clear', info });
      if (info.attack > 0) this.sendAttack(info.attack);
    }
    this.lines += lines;
    this.holdUsed = false;
    // Garbage only rises on a lock that clears nothing, so a combo holds it back.
    if (lines === 0 && !this.riseGarbage()) {
      this.topOut('garbageOut');
      return;
    }

    if (this.config.goalLines !== undefined && this.lines >= this.config.goalLines) {
      this.finished = true;
      this.events.push({ type: 'finish', tick: this.tick });
      return;
    }
    if (this.config.entryDelay > 0) this.entryTimer = this.config.entryDelay;
    else this.spawn(this.takeNext());
  }

  /** Cancels waiting garbage first, then reports what is left as sent. */
  private sendAttack(raw: number): void {
    let left = raw;
    while (left > 0 && this.incoming.length > 0) {
      const g = this.incoming[0];
      const used = Math.min(left, g.lines);
      g.lines -= used;
      left -= used;
      if (g.lines === 0) this.incoming.shift();
    }
    this.attackSent += left;
    this.events.push({ type: 'attack', info: { raw, cancelled: raw - left, sent: left, tick: this.tick } });
  }

  /** Raises up to garbageCap ready lines. Returns false if that pushed blocks off the top. */
  private riseGarbage(): boolean {
    let budget = this.config.garbageCap;
    let risen = 0;
    let ok = true;
    while (budget > 0 && this.incoming.length > 0 && this.incoming[0].readyTick <= this.tick) {
      const g = this.incoming[0];
      const n = Math.min(budget, g.lines);
      if (this.config.garbageHoles === 'perAttack') {
        ok = this.board.addGarbage(n, g.hole, GARBAGE_CELL) && ok;
      } else {
        for (let i = 0; i < n; i++) ok = this.board.addGarbage(1, this.garbageRng.int(BOARD_WIDTH), GARBAGE_CELL) && ok;
      }
      g.lines -= n;
      budget -= n;
      risen += n;
      if (g.lines === 0) this.incoming.shift();
    }
    if (risen > 0) {
      this.garbageReceived += risen;
      this.events.push({ type: 'garbage', lines: risen, tick: this.tick });
    }
    return ok;
  }
}
