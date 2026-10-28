import { BotBoard, findPlacements, type Placement } from '@line-battle/bot';
import { PIECE_CELLS, type Game, type Key, type PieceType } from '@line-battle/engine';
import { t } from './i18n';

/** A spot picked for the piece, as board cells (x, y up from the bottom row). */
export interface TapPreview {
  type: PieceType;
  cells: [number, number][];
}

/** Less movement than this is a tap. */
const TAP_SLOP_PX = 12;
/** A tap or a drop swipe is over within this time. */
const SWIPE_MAX_MS = 350;
/** How far down a swipe goes to drop the piece. */
const DROP_SWIPE_PX = 60;

/** Finger travel per board column: about a twelfth of the screen, so a thumb can sweep the whole board. */
function columnPx(): number {
  return Math.max(24, innerWidth / 12);
}

/** The how-to line shows until a player has dropped this many pieces by touch. */
const HINT_DROPS = 40;
const DROPS_KEY = 'lineBattle.tapDrops';

function drops(): number {
  try {
    return Number(localStorage.getItem(DROPS_KEY)) || 0;
  } catch {
    return 0;
  }
}

function countDrop(): void {
  try {
    localStorage.setItem(DROPS_KEY, String(drops() + 1));
  } catch {
    /* the hint just keeps showing */
  }
}

function cellsOf(p: Placement): [number, number][] {
  return PIECE_CELLS[p.type][p.rot].map(([dx, dy]) => [p.x + dx, p.y + dy]);
}

function sameCells(a: Placement, b: Placement): boolean {
  const key = (p: Placement) => cellsOf(p).map(([x, y]) => y * 16 + x).sort((m, n) => m - n).join(',');
  return key(a) === key(b);
}

/** The piece's outline in a rotation, wherever it is: S, Z and I look the same two ways round. */
function shapeOf(type: PieceType, rot: number): string {
  const cells = PIECE_CELLS[type][rot];
  const x0 = Math.min(...cells.map(([x]) => x));
  const y0 = Math.min(...cells.map(([, y]) => y));
  return cells.map(([x, y]) => (y - y0) * 4 + (x - x0)).sort((a, b) => a - b).join(',');
}

function centerX(p: Placement): number {
  const cells = cellsOf(p);
  return cells.reduce((s, [x]) => s + x, 0) / cells.length;
}

/**
 * Tap to place: an outline shows where the piece will go. Drag a thumb
 * sideways anywhere to move it, tap to turn it, swipe down or press the drop
 * button to put the piece there. The rotate buttons turn
 * the shown spot, Hold swaps the piece. Placements come from the bot's move
 * search, limited to ones reached without soft drop so any handling works,
 * and are played as ordinary key taps.
 */
export class TapControls {
  /** Full-screen layer that takes taps on the board. */
  readonly layer: HTMLElement;
  /** Hold, rotate and drop buttons, with a how-to line above them for new players. */
  readonly bar: HTMLElement;
  private hint: HTMLElement;
  preview: Placement | null = null;
  private placements: Placement[] = [];
  /** Changes whenever there's a new piece or the board changes. */
  private pieceKey = '';
  private queue: Key[] = [];
  private game: Game | null = null;
  /** Pieces placed when Drop was last pressed, so a double press can't drop the next piece too. */
  private droppedAt = -1;
  /** The finger steering the outline: where it went down, and the column it steers from (null until there's a piece). */
  private finger: { id: number; x: number; y: number; at: number; anchorX: number; center: number | null; moved: boolean } | null = null;

  constructor(
    parent: HTMLElement,
    private press: (key: Key) => void,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'swipe hidden';
    // One thumb anywhere on the screen: drag sideways moves the outline, a tap turns it,
    // a quick swipe down drops. The drop button does the same as the swipe.
    // A new touch always takes over, so a lost pointerup can never leave the controls stuck.
    this.layer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.layer.setPointerCapture?.(e.pointerId);
      this.finger = { id: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp, anchorX: e.clientX, center: null, moved: false };
    }, { passive: false });
    this.layer.addEventListener('pointermove', (e) => {
      const f = this.finger;
      if (!f || e.pointerId !== f.id) return;
      const dx = e.clientX - f.x;
      const dy = e.clientY - f.y;
      if (Math.hypot(dx, dy) > TAP_SLOP_PX) f.moved = true;
      if (!this.preview) return;
      // A drag that started between pieces (or on the last piece) steers the current one from here.
      if (f.center === null) {
        f.center = centerX(this.preview);
        f.anchorX = e.clientX;
      }
      // Mostly downward is a drop swipe, not a move.
      if (dy > Math.abs(dx) * 1.5) return;
      const cols = Math.round((e.clientX - f.anchorX) / columnPx());
      this.preview = this.nearest(this.preview.rot, f.center + cols) ?? this.preview;
    });
    this.layer.addEventListener('pointerup', (e) => {
      const f = this.finger;
      if (!f || e.pointerId !== f.id) return;
      this.finger = null;
      const dx = e.clientX - f.x;
      const dy = e.clientY - f.y;
      const quick = e.timeStamp - f.at < SWIPE_MAX_MS;
      if (!f.moved && quick) return this.turn(1);
      if (quick && dy > DROP_SWIPE_PX && dy > Math.abs(dx) * 1.5) this.drop();
    });
    for (const type of ['pointercancel', 'lostpointercapture'] as const) {
      this.layer.addEventListener(type, (e) => {
        if (this.finger?.id === e.pointerId) this.finger = null;
      });
    }
    this.layer.addEventListener('contextmenu', (e) => e.preventDefault());

    this.bar = document.createElement('div');
    this.bar.className = 'touchpad tapbar hidden';
    this.hint = document.createElement('p');
    this.hint.className = 'tap-hint';
    this.hint.textContent = t('Drag ← → anywhere to move · Tap to turn · Swipe ↓ to drop');
    this.bar.append(this.hint);
    const groups: [string, string, () => void][][] = [
      [['HOLD', 'Hold', () => this.queue.push('hold')], ['↺', 'Rotate counter-clockwise', () => this.turn(3)]],
      [['↻', 'Rotate clockwise', () => this.turn(1)], ['⤓', 'Drop', () => this.drop()]],
    ];
    for (const [i, group] of groups.entries()) {
      const cluster = document.createElement('div');
      cluster.className = `touch-cluster ${i === 0 ? 'left' : 'right'}`;
      for (const [icon, label, act] of group) {
        const b = document.createElement('div');
        b.className = `touch-btn${icon === '⤓' ? ' hardDrop' : icon === 'HOLD' ? ' hold' : ''}`;
        b.textContent = icon === 'HOLD' ? t('Hold').toUpperCase() : icon;
        b.setAttribute('role', 'button');
        b.setAttribute('aria-label', t(label));
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          b.classList.add('pressed');
          act();
        }, { passive: false });
        for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) b.addEventListener(type, () => b.classList.remove('pressed'));
        cluster.append(b);
      }
      this.bar.append(cluster);
    }
    this.bar.addEventListener('contextmenu', (e) => e.preventDefault());
    parent.append(this.layer, this.bar);
  }

  get visible(): boolean {
    return !this.layer.classList.contains('hidden');
  }

  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.layer.classList.toggle('hidden', !on);
    this.bar.classList.toggle('hidden', !on);
    this.queue = [];
    this.preview = null;
    this.pieceKey = '';
    this.finger = null;
    this.hint.classList.toggle('hidden', drops() >= HINT_DROPS);
  }

  /** Each frame: follows your game, and plays queued taps once a piece is in play. */
  update(game: Game | null): void {
    this.game = game;
    const active = game?.active;
    if (!game || !active || game.over) {
      this.preview = null;
      return;
    }
    const board = BotBoard.from(game.board);
    const key = `${game.piecesPlaced}:${active.type}:${game.hold}:${board.rows.join(',')}`;
    if (key !== this.pieceKey) {
      this.pieceKey = key;
      const old = this.preview;
      this.placements = this.search(game, board);
      // Keep the spot picked for this piece if it's still there; otherwise start from where it would land now.
      this.preview = (old && old.type === active.type && this.placements.find((p) => sameCells(p, old))) || this.nearest(active.rot, active.x + 1.5);
      // A finger still down steers the new piece from where it is now.
      if (this.finger && this.preview !== old) this.finger.center = null;
    }
    for (const k of this.queue) this.press(k);
    this.queue = [];
  }

  /** The spot to draw over the board. */
  get shown(): TapPreview | null {
    return this.preview ? { type: this.preview.type, cells: cellsOf(this.preview) } : null;
  }

  private search(game: Game, board: BotBoard): Placement[] {
    const a = game.active!;
    return findPlacements(board, a.type, { x: a.x, y: a.y, rot: a.rot }).filter((p) => !p.inputs.includes('softDrop'));
  }

  /**
   * The placement shaped like rotation `rot` closest to column `x` (its middle). Matching the
   * shape, not the rotation, matters: the move search keeps one of two rotations that fill the
   * same cells, so an upright Z can be rotation 1 in one column and 3 in the next.
   */
  private nearest(rot: number, x: number): Placement | null {
    let best: Placement | null = null;
    let bestD = Infinity;
    if (!this.placements.length) return null;
    const shape = shapeOf(this.placements[0].type, rot);
    for (const p of this.placements) {
      if (shapeOf(p.type, p.rot) !== shape) continue;
      const d = Math.abs(centerX(p) - x);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  /** Turns the shown spot, keeping it near the same column; shapes that repeat are skipped. */
  private turn(dir: 1 | 3): void {
    const p = this.preview;
    if (!p) return;
    const now = shapeOf(p.type, p.rot);
    for (let i = 1; i <= 3; i++) {
      const rot = (p.rot + dir * i) % 4;
      if (shapeOf(p.type, rot) === now) continue;
      const next = this.nearest(rot, centerX(p));
      if (next) {
        this.preview = next;
        return;
      }
    }
  }

  private drop(): void {
    const game = this.game;
    const want = this.preview;
    if (!game?.active || !want || game.piecesPlaced === this.droppedAt) return;
    // The piece may have fallen since the spot was picked: find the way there from where it is now.
    const now = this.search(game, BotBoard.from(game.board));
    const plan = now.find((p) => sameCells(p, want)) ?? null;
    if (!plan) {
      this.placements = now;
      this.preview = this.nearest(want.rot, centerX(want));
      return;
    }
    this.droppedAt = game.piecesPlaced;
    countDrop();
    this.queue.push(...plan.inputs, 'hardDrop');
  }
}
