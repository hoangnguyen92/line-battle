import {
  BOARD_WIDTH,
  PIECE_CELLS,
  PIECE_TYPES,
  TICK_RATE,
  VISIBLE_HEIGHT,
  type Game,
  type Match,
  type PieceType,
} from '@line-battle/engine';
import { shade, type CharacterView } from './character';

const CELL = 30;
const MINI = 20;
const SPAWN_ROWS = 3; // rows drawn above the visible field so spawning pieces show
const BOARD_X = 180;
const BOARD_Y = 20 + SPAWN_ROWS * CELL;
const SIDE_W = 140;
/** Width of one player's side: hold, board and queue. */
const VIEW_W = BOARD_X * 2 + BOARD_WIDTH * CELL;
const VERSUS_GAP = 30;
const CANVAS_H = BOARD_Y + VISIBLE_HEIGHT * CELL + 30;
const QUEUE_X = BOARD_X + BOARD_WIDTH * CELL + 16;
const QUEUE_H = 5 * 64 + 12;
/** The character stands in the space under the next queue. */
const CHAR_Y = BOARD_Y + QUEUE_H + 14;
const CHAR_H = VISIBLE_HEIGHT * CELL - QUEUE_H - 14;
const METER_W = 8;
const METER_X = BOARD_X - METER_W - 4;

export type Layout = 'solo' | 'versus';

export const PLAYER_COLORS = ['#3fc1b0', '#f08a5d'] as const;

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

export interface VersusHud {
  countdown: string | null;
  popups: [Popup | null, Popup | null];
  characters: [CharacterView, CharacterView];
  /** Rounds won by each player. */
  score: [number, number];
  roundsToWin: number;
  /** Big text over both boards, e.g. at the end of a round. */
  banner: string | null;
  /** Shown above each board. */
  names: [string, string];
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
  private layout: Layout = 'solo';

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setLayout(layout: Layout): void {
    if (layout === this.layout) return;
    this.layout = layout;
    this.resize();
  }

  private get width(): number {
    return this.layout === 'solo' ? VIEW_W : VIEW_W * 2 + VERSUS_GAP;
  }

  /** Fits the canvas to the window while keeping pixels crisp on high-DPI screens. */
  resize(): void {
    const w = this.width;
    const scale = Math.min(innerWidth / w, innerHeight / CANVAS_H, 1.6);
    const dpr = devicePixelRatio || 1;
    this.canvas.style.width = `${Math.floor(w * scale)}px`;
    this.canvas.style.height = `${Math.floor(CANVAS_H * scale)}px`;
    this.canvas.width = Math.floor(w * scale * dpr);
    this.canvas.height = Math.floor(CANVAS_H * scale * dpr);
    this.ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }

  draw(game: Game | null, hud: HudState): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.width, CANVAS_H);
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

  /** Two boards side by side, each with its garbage meter and character. */
  drawVersus(match: Match, hud: VersusHud): void {
    const c = this.ctx;
    const now = performance.now();
    c.clearRect(0, 0, this.width, CANVAS_H);
    match.players.forEach((game, i) => {
      const character = hud.characters[i];
      const [sx, sy] = character.shake(now);
      c.save();
      c.translate(i * (VIEW_W + VERSUS_GAP) + sx, sy);
      this.drawWell();
      this.drawStack(game);
      this.drawActive(game);
      this.drawGarbageMeter(game, match.tick);
      this.drawHold(game);
      this.drawQueue(game);
      this.drawVersusStats(game, i, hud);
      this.drawPopup(hud.popups[i]);
      this.panel(QUEUE_X, CHAR_Y, SIDE_W, CHAR_H);
      character.draw(c, QUEUE_X, CHAR_Y, SIDE_W, CHAR_H, now);
      if (hud.countdown) this.drawCenterText(hud.countdown);
      c.restore();
    });
    if (hud.banner) this.drawBanner(hud.banner);
  }

  /**
   * Red bar beside the board for garbage that can rise now, orange for
   * garbage still in its delay (the window to cancel it).
   */
  private drawGarbageMeter(game: Game, tick: number): void {
    const c = this.ctx;
    const bottom = BOARD_Y + VISIBLE_HEIGHT * CELL;
    c.fillStyle = '#151724';
    c.fillRect(METER_X, BOARD_Y, METER_W, VISIBLE_HEIGHT * CELL);
    let y = bottom;
    for (const g of game.incoming) {
      const h = Math.min(g.lines * CELL, y - BOARD_Y);
      if (h <= 0) break;
      c.fillStyle = g.readyTick <= tick ? '#ff4d5e' : '#ffae42';
      c.fillRect(METER_X, y - h, METER_W, h - 1);
      y -= h;
    }
  }

  private drawVersusStats(game: Game, player: number, hud: VersusHud): void {
    const c = this.ctx;
    const right = BOARD_X - 16;
    const color = PLAYER_COLORS[player];
    // Name and round pips above the hold box.
    c.fillStyle = color;
    c.font = `800 16px ${FONT}`;
    c.textAlign = 'left';
    const name = hud.names[player];
    c.fillText(name, right - SIDE_W, BOARD_Y - 40);
    const pipsX = right - SIDE_W + c.measureText(name).width + 16;
    for (let r = 0; r < hud.roundsToWin; r++) {
      c.beginPath();
      c.arc(pipsX + r * 16, BOARD_Y - 45, 5, 0, Math.PI * 2);
      c.fillStyle = r < hud.score[player] ? color : '#2b2f45';
      c.fill();
    }

    let y = BOARD_Y + VISIBLE_HEIGHT * CELL - 130;
    const minutes = game.tick / TICK_RATE / 60;
    const rows: [string, string][] = [
      ['SENT', String(game.attackSent)],
      ['APM', minutes > 0 ? (game.attackSent / minutes).toFixed(1) : '0.0'],
      ['PPS', minutes > 0 ? (game.piecesPlaced / (minutes * 60)).toFixed(2) : '0.00'],
    ];
    for (const [name, value] of rows) {
      this.label(name, right, y, 'right');
      c.fillStyle = '#e8e9f1';
      c.font = `700 20px ${FONT}`;
      c.textAlign = 'right';
      c.fillText(value, right, y + 24);
      y += 44;
    }
  }

  private drawBanner(text: string): void {
    const c = this.ctx;
    const w = this.width;
    c.fillStyle = 'rgba(7,8,13,0.7)';
    c.fillRect(0, CANVAS_H / 2 - 50, w, 100);
    c.fillStyle = '#ffffff';
    c.font = `800 44px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, CANVAS_H / 2);
    c.textBaseline = 'alphabetic';
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
    const x = QUEUE_X;
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
