import { BotBoard, findPlacements, type Placement } from '@line-battle/bot';
import { PIECE_CELLS, type Game, type Key, type PieceType } from '@line-battle/engine';
import { t } from './i18n';

/** A spot picked for the piece, as board cells (x, y up from the bottom row). */
export interface TapPreview {
  type: PieceType;
  cells: [number, number][];
}

function cellsOf(p: Placement): [number, number][] {
  return PIECE_CELLS[p.type][p.rot].map(([dx, dy]) => [p.x + dx, p.y + dy]);
}

function sameCells(a: Placement, b: Placement): boolean {
  const key = (p: Placement) => cellsOf(p).map(([x, y]) => y * 16 + x).sort((m, n) => m - n).join(',');
  return key(a) === key(b);
}

function centerX(p: Placement): number {
  const cells = cellsOf(p);
  return cells.reduce((s, [x]) => s + x, 0) / cells.length;
}

/**
 * Tap to place: touch or drag on the board and an outline shows where the
 * piece will go; the drop button puts it there. The rotate buttons turn
 * the shown spot, Hold swaps the piece. Placements come from the bot's move
 * search, limited to ones reached without soft drop so any handling works,
 * and are played as ordinary key taps.
 */
export class TapControls {
  /** Full-screen layer that takes taps on the board. */
  readonly layer: HTMLElement;
  /** Hold, rotate and drop buttons. */
  readonly bar: HTMLElement;
  preview: Placement | null = null;
  private placements: Placement[] = [];
  /** Changes whenever there's a new piece or the board changes. */
  private pieceKey = '';
  private queue: Key[] = [];
  private game: Game | null = null;
  /** Pieces placed when Drop was last pressed, so a double press can't drop the next piece too. */
  private droppedAt = -1;

  constructor(
    parent: HTMLElement,
    /** Board cell under a screen point, or null when it's off your board. */
    private cellAt: (clientX: number, clientY: number) => [number, number] | null,
    private press: (key: Key) => void,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'swipe hidden';
    // Touching or dragging over the board moves the outline; only the drop button drops.
    let steering: number | null = null;
    this.layer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      steering = e.pointerId;
      this.layer.setPointerCapture?.(e.pointerId);
      this.aimAt(e.clientX, e.clientY);
    }, { passive: false });
    this.layer.addEventListener('pointermove', (e) => {
      if (e.pointerId === steering) this.aimAt(e.clientX, e.clientY);
    });
    for (const type of ['pointerup', 'pointercancel'] as const) this.layer.addEventListener(type, () => (steering = null));
    this.layer.addEventListener('contextmenu', (e) => e.preventDefault());

    this.bar = document.createElement('div');
    this.bar.className = 'touchpad tapbar hidden';
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

  /** The placement in rotation `rot` closest to column `x` (its middle). */
  private nearest(rot: number, x: number): Placement | null {
    let best: Placement | null = null;
    let bestD = Infinity;
    for (const p of this.placements) {
      if (p.rot !== rot) continue;
      const d = Math.abs(centerX(p) - x);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  /** Moves the outline to the column under the finger, keeping its rotation. */
  private aimAt(clientX: number, clientY: number): void {
    const cell = this.cellAt(clientX, clientY);
    if (!cell || !this.game?.active) return;
    const rot = this.preview?.rot ?? this.game.active.rot;
    // The spot in this rotation centred on the column as near as it can be.
    this.preview = this.nearest(rot, cell[0]) ?? this.preview;
  }

  /** Turns the shown spot, keeping it near the same column; shapes that repeat are skipped. */
  private turn(dir: 1 | 3): void {
    const p = this.preview;
    if (!p) return;
    for (let i = 1; i <= 3; i++) {
      const next = this.nearest((p.rot + dir * i) % 4, centerX(p));
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
    this.queue.push(...plan.inputs, 'hardDrop');
  }
}
