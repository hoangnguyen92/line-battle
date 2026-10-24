import {
  BOARD_WIDTH,
  PIECE_CELLS,
  PIECE_TYPES,
  TICK_RATE,
  VISIBLE_HEIGHT,
  type Game,
  type PieceType,
} from '@line-battle/engine';

const CELL = 30;
const MINI = 20;
const SPAWN_ROWS = 3; // rows drawn above the visible field so spawning pieces show
const BOARD_X = 180;
const BOARD_Y = 20 + SPAWN_ROWS * CELL;
const SIDE_W = 140;
export const CANVAS_W = BOARD_X * 2 + BOARD_WIDTH * CELL;
export const CANVAS_H = BOARD_Y + VISIBLE_HEIGHT * CELL + 30;

const COLORS: Record<PieceType, string> = {
  I: '#35c8de',
  J: '#4069e6',
  L: '#ee8a2f',
  O: '#eecb3a',
  S: '#5ccb4a',
  T: '#a650e0',
  Z: '#e64a55',
};
const GARBAGE_COLOR = '#6b6f82';
// Indexed by board cell value: 0 empty, 1-7 pieces (CELL_ID order), 8 garbage.
const CELL_COLORS = ['', ...PIECE_TYPES.map((t) => COLORS[t]), GARBAGE_COLOR];

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export interface Popup {
  lines: string[];
  /** performance.now() when it appeared. */
  at: number;
}

export interface HudState {
  goalLines: number;
  countdown: string | null;
  popup: Popup | null;
}

export function formatTime(ticks: number): string {
  const ms = Math.floor((ticks * 1000) / TICK_RATE);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = String(ms % 1000).padStart(3, '0');
  return `${m}:${String(s).padStart(2, '0')}.${rest}`;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /** Fits the canvas to the window while keeping pixels crisp on high-DPI screens. */
  resize(): void {
    const scale = Math.min(innerWidth / CANVAS_W, innerHeight / CANVAS_H, 1.6);
    const dpr = devicePixelRatio || 1;
    this.canvas.style.width = `${Math.floor(CANVAS_W * scale)}px`;
    this.canvas.style.height = `${Math.floor(CANVAS_H * scale)}px`;
    this.canvas.width = Math.floor(CANVAS_W * scale * dpr);
    this.canvas.height = Math.floor(CANVAS_H * scale * dpr);
    this.ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }

  draw(game: Game | null, hud: HudState): void {
    const c = this.ctx;
    c.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.drawWell();
    if (!game) return;
    this.drawStack(game);
    this.drawActive(game);
    this.drawHold(game);
    this.drawQueue(game);
    this.drawStats(game, hud);
    this.drawPopup(hud.popup);
    if (hud.countdown) this.drawCenterText(hud.countdown);
  }

  private drawWell(): void {
    const c = this.ctx;
    const w = BOARD_WIDTH * CELL;
    const h = VISIBLE_HEIGHT * CELL;
    c.fillStyle = '#07080d';
    c.fillRect(BOARD_X, BOARD_Y, w, h);
    c.strokeStyle = '#1a1c29';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 1; x < BOARD_WIDTH; x++) {
      c.moveTo(BOARD_X + x * CELL + 0.5, BOARD_Y);
      c.lineTo(BOARD_X + x * CELL + 0.5, BOARD_Y + h);
    }
    for (let y = 1; y < VISIBLE_HEIGHT; y++) {
      c.moveTo(BOARD_X, BOARD_Y + y * CELL + 0.5);
      c.lineTo(BOARD_X + w, BOARD_Y + y * CELL + 0.5);
    }
    c.stroke();
    c.strokeStyle = '#3a3e57';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(BOARD_X - 1, BOARD_Y);
    c.lineTo(BOARD_X - 1, BOARD_Y + h + 1);
    c.lineTo(BOARD_X + w + 1, BOARD_Y + h + 1);
    c.lineTo(BOARD_X + w + 1, BOARD_Y);
    c.stroke();
  }

  /** Screen position of board cell (x, y), y up from the bottom row. */
  private cellPos(x: number, y: number): [number, number] {
    return [BOARD_X + x * CELL, BOARD_Y + (VISIBLE_HEIGHT - 1 - y) * CELL];
  }

  private drawStack(game: Game): void {
    const top = VISIBLE_HEIGHT + SPAWN_ROWS;
    for (let y = 0; y < top; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        const v = game.board.get(x, y);
        if (v) this.drawBlock(...this.cellPos(x, y), CELL, CELL_COLORS[v], game.toppedOut ? 0.45 : 1);
      }
    }
  }

  private drawActive(game: Game): void {
    const ghost = game.ghost();
    const p = game.active;
    if (!p || !ghost) return;
    for (const [x, y] of game.pieceCells(ghost)) this.drawGhost(...this.cellPos(x, y), COLORS[p.type]);
    const c = this.ctx;
    c.save();
    c.shadowColor = COLORS[p.type];
    c.shadowBlur = 14;
    for (const [x, y] of game.pieceCells(p)) this.drawBlock(...this.cellPos(x, y), CELL, COLORS[p.type]);
    c.restore();
  }

  private drawGhost(x: number, y: number, color: string): void {
    const c = this.ctx;
    const inset = 2;
    c.save();
    c.beginPath();
    c.roundRect(x + inset + 0.5, y + inset + 0.5, CELL - inset * 2 - 1, CELL - inset * 2 - 1, 4);
    c.globalAlpha = 0.12;
    c.fillStyle = color;
    c.fill();
    c.globalAlpha = 0.55;
    c.strokeStyle = color;
    c.lineWidth = 1.5;
    c.stroke();
    c.restore();
  }

  /** A glossy, bevelled gem-style block. */
  private drawBlock(x: number, y: number, size: number, color: string, alpha = 1): void {
    const c = this.ctx;
    const gap = size >= CELL ? 1 : 0.75;
    const r = size * 0.16;
    const bx = x + gap, by = y + gap, s = size - gap * 2;
    c.save();
    c.globalAlpha = alpha;

    // Body: light at the top, deep at the bottom.
    const body = c.createLinearGradient(bx, by, bx, by + s);
    body.addColorStop(0, shade(color, 0.25));
    body.addColorStop(0.5, color);
    body.addColorStop(1, shade(color, -0.35));
    c.beginPath();
    c.roundRect(bx, by, s, s, r);
    c.fillStyle = body;
    c.fill();
    c.shadowBlur = 0;

    // Raised inner face.
    const inset = s * 0.16;
    const face = c.createLinearGradient(bx, by + inset, bx, by + s - inset);
    face.addColorStop(0, shade(color, 0.12));
    face.addColorStop(1, shade(color, -0.12));
    c.beginPath();
    c.roundRect(bx + inset, by + inset, s - inset * 2, s - inset * 2, r * 0.6);
    c.fillStyle = face;
    c.fill();

    // Gloss across the upper half.
    const gloss = c.createLinearGradient(bx, by, bx, by + s * 0.55);
    gloss.addColorStop(0, 'rgba(255,255,255,0.45)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    c.beginPath();
    c.roundRect(bx + 1, by + 1, s - 2, s * 0.5, [r, r, r * 0.3, r * 0.3]);
    c.fillStyle = gloss;
    c.fill();

    // Crisp dark rim so neighbouring blocks read as separate.
    c.beginPath();
    c.roundRect(bx + 0.5, by + 0.5, s - 1, s - 1, r);
    c.strokeStyle = shade(color, -0.55);
    c.globalAlpha = alpha * 0.8;
    c.lineWidth = 1;
    c.stroke();
    c.restore();
  }

  private drawMiniPiece(type: PieceType, cx: number, cy: number, dim = false): void {
    const cells = PIECE_CELLS[type][0];
    const xs = cells.map(([dx]) => dx);
    const ys = cells.map(([, dy]) => -dy);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const ox = cx - ((maxX - minX + 1) * MINI) / 2;
    const oy = cy - ((maxY - minY + 1) * MINI) / 2;
    for (const [dx, dy] of cells) {
      this.drawBlock(ox + (dx - minX) * MINI, oy + (-dy - minY) * MINI, MINI, dim ? '#4a4d5e' : COLORS[type]);
    }
  }

  private label(text: string, x: number, y: number, align: CanvasTextAlign = 'left'): void {
    const c = this.ctx;
    c.fillStyle = '#8b8fa8';
    c.font = `600 13px ${FONT}`;
    c.textAlign = align;
    c.textBaseline = 'alphabetic';
    c.fillText(text, x, y);
  }

  private panel(x: number, y: number, w: number, h: number): void {
    const c = this.ctx;
    c.fillStyle = '#111320';
    c.strokeStyle = '#262a3d';
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(x + 0.5, y + 0.5, w, h, 8);
    c.fill();
    c.stroke();
  }

  private drawHold(game: Game): void {
    const x = BOARD_X - SIDE_W - 16;
    const y = BOARD_Y;
    this.label('HOLD', x, y - 8);
    this.panel(x, y, SIDE_W, 80);
    if (game.hold) this.drawMiniPiece(game.hold, x + SIDE_W / 2, y + 40, game.holdUsed);
  }

  private drawQueue(game: Game): void {
    const x = BOARD_X + BOARD_WIDTH * CELL + 16;
    const y = BOARD_Y;
    this.label('NEXT', x, y - 8);
    const queue = game.queue;
    this.panel(x, y, SIDE_W, queue.length * 64 + 12);
    queue.forEach((t, i) => this.drawMiniPiece(t, x + SIDE_W / 2, y + 38 + i * 64));
  }

  private drawStats(game: Game, hud: HudState): void {
    const c = this.ctx;
    const right = BOARD_X - 16;
    let y = BOARD_Y + VISIBLE_HEIGHT * CELL - 190;
    const seconds = game.tick / TICK_RATE;
    const pps = seconds > 0 ? game.piecesPlaced / seconds : 0;
    const rows: [string, string][] = [
      ['LINES', `${Math.min(game.lines, hud.goalLines)}/${hud.goalLines}`],
      ['PIECES', `${game.piecesPlaced}  ·  ${pps.toFixed(2)}/s`],
      ['TIME', formatTime(game.tick)],
    ];
    for (const [name, value] of rows) {
      this.label(name, right, y, 'right');
      c.fillStyle = '#e8e9f1';
      c.font = `700 ${name === 'TIME' ? 30 : 22}px ${FONT}`;
      c.textAlign = 'right';
      c.fillText(value, right, y + (name === 'TIME' ? 34 : 28));
      y += name === 'TIME' ? 60 : 56;
    }
  }

  private drawPopup(popup: Popup | null): void {
    if (!popup) return;
    const age = performance.now() - popup.at;
    if (age > 1600) return;
    const c = this.ctx;
    c.globalAlpha = age < 1200 ? 1 : 1 - (age - 1200) / 400;
    c.textAlign = 'right';
    const x = BOARD_X - 16;
    let y = BOARD_Y + 150;
    popup.lines.forEach((line, i) => {
      c.fillStyle = i === 0 ? '#ffffff' : '#c9b8ff';
      c.font = `800 ${i === 0 ? 22 : 16}px ${FONT}`;
      c.fillText(line, x, y);
      y += i === 0 ? 28 : 22;
    });
    c.globalAlpha = 1;
  }

  private drawCenterText(text: string): void {
    const c = this.ctx;
    c.fillStyle = 'rgba(7,8,13,0.55)';
    c.fillRect(BOARD_X, BOARD_Y, BOARD_WIDTH * CELL, VISIBLE_HEIGHT * CELL);
    c.fillStyle = '#ffffff';
    c.font = `800 64px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, BOARD_X + (BOARD_WIDTH * CELL) / 2, BOARD_Y + (VISIBLE_HEIGHT * CELL) / 2);
    c.textBaseline = 'alphabetic';
  }
}

/** Lightens (amount > 0) or darkens (amount < 0) a #rrggbb colour. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (v: number) => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  const r = mix(n >> 16), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `rgb(${r},${g},${b})`;
}
