import {
  BOARD_WIDTH,
  CELL_ID,
  PIECE_CELLS,
  TICK_RATE,
  VISIBLE_HEIGHT,
  type Game,
  type PieceType,
} from '@line-battle/engine';
import type { CharacterView } from './character';
import type { TapPreview } from './tap';
import { t } from './i18n';
import { drawCell, PIECE_COLORS, skinSheet, THEME_COLORS, type SkinSheet, type Theme } from './skins';

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

// Phone layout for versus (a tall, narrow screen): your full board, and the
// opponent's board shrunk into the column under your next queue.
const COMPACT_QUEUE = 3;
const COMPACT_QUEUE_H = COMPACT_QUEUE * 64 + 12;
const MINI_SCALE = 0.36;
const MINI_Y = BOARD_Y + COMPACT_QUEUE_H + 40;
const MINI_X = QUEUE_X + (SIDE_W - BOARD_WIDTH * CELL * MINI_SCALE) / 2 + 4;
const OPP_CHAR_Y = MINI_Y + VISIBLE_HEIGHT * CELL * MINI_SCALE + 10;
const OPP_CHAR_H = BOARD_Y + VISIBLE_HEIGHT * CELL - OPP_CHAR_Y;
/** Your character sits in the left column, under hold and above the stats. */
const MY_CHAR_Y = BOARD_Y + 96;
const MY_CHAR_H = 210;
const COMPACT_POPUP_Y = MY_CHAR_Y + MY_CHAR_H + 32;

export type Layout = 'solo' | 'versus';

export const PLAYER_COLORS = ['#3fc1b0', '#f08a5d'] as const;


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
  /** Small line at the top, e.g. "Opponent reconnecting...". */
  status?: string | null;
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
  private theme: Theme = THEME_COLORS.night;
  /** Block skin for each side: [you or player 1, opponent or player 2]. */
  private sheets: [SkinSheet, SkinSheet] = [skinSheet('gem'), skinSheet('gem')];
  /** The sheet for the side being drawn right now. */
  private sheet: SkinSheet = this.sheets[0];
  /** Screen space kept free for touch buttons: below the canvas, and on each side. */
  private reserved = { bottom: 0, sides: 0 };
  /** Versus on a tall, narrow screen: the opponent's board is drawn small. */
  private compact = false;
  /** CSS pixels per canvas unit. */
  private scale = 1;
  /** Tap-to-place: where your piece will go, drawn instead of the ghost. */
  private tapPreview: TapPreview | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  setSkins(sheets: [SkinSheet, SkinSheet]): void {
    this.sheets = sheets;
  }

  setLayout(layout: Layout): void {
    if (layout === this.layout) return;
    this.layout = layout;
    this.resize();
  }

  /** Keeps `bottom` px free under the canvas and `sides` px free left and right of it. */
  setReserved(bottom: number, sides: number): void {
    if (bottom === this.reserved.bottom && sides === this.reserved.sides) return;
    this.reserved = { bottom, sides };
    this.resize();
  }

  setTapPreview(preview: TapPreview | null): void {
    this.tapPreview = preview;
  }

  /**
   * The cell of your board (x, y up from the bottom) under a screen point.
   * Points a little outside the board snap to its edge; further out is null.
   */
  cellAt(clientX: number, clientY: number): [number, number] | null {
    const r = this.canvas.getBoundingClientRect();
    const ux = (clientX - r.left) / this.scale;
    const uy = (clientY - r.top) / this.scale;
    const col = Math.floor((ux - BOARD_X) / CELL);
    if (col < -1 || col > BOARD_WIDTH) return null;
    const row = VISIBLE_HEIGHT - 1 - Math.floor((uy - BOARD_Y) / CELL);
    if (row < -2) return null;
    return [Math.max(0, Math.min(BOARD_WIDTH - 1, col)), Math.max(0, Math.min(VISIBLE_HEIGHT - 1, row))];
  }

  /** How wide one cell of your board is on screen, in CSS pixels. */
  get cellPx(): number {
    return CELL * this.scale;
  }

  private get width(): number {
    return this.layout === 'solo' || this.compact ? VIEW_W : VIEW_W * 2 + VERSUS_GAP;
  }

  /** Fits the canvas to the window while keeping pixels crisp on high-DPI screens. */
  resize(): void {
    const freeW = Math.max(1, innerWidth - 2 * this.reserved.sides);
    const freeH = Math.max(1, innerHeight - this.reserved.bottom);
    // Side by side unless that would draw the boards much smaller than one big and one small.
    const wide = Math.min(freeW / (VIEW_W * 2 + VERSUS_GAP), freeH / CANVAS_H);
    const narrow = Math.min(freeW / VIEW_W, freeH / CANVAS_H);
    this.compact = this.layout === 'versus' && wide < narrow * 0.75;
    const w = this.width;
    const scale = Math.min(freeW / w, freeH / CANVAS_H, 1.6);
    this.scale = scale;
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
    this.sheet = this.sheets[0];
    this.drawWell();
    if (!game) return;
    this.drawStack(game);
    this.drawActive(game, true);
    this.drawHold(game);
    this.drawQueue(game);
    this.drawStats(game, hud);
    this.drawPopup(hud.popup);
    if (hud.countdown) this.drawCenterText(hud.countdown);
  }

  /** Two boards side by side, each with its garbage meter and character. */
  drawVersus(match: { readonly players: readonly [Game, Game] }, hud: VersusHud): void {
    if (this.compact) return this.drawVersusCompact(match, hud);
    const c = this.ctx;
    const now = performance.now();
    c.clearRect(0, 0, this.width, CANVAS_H);
    match.players.forEach((game, i) => {
      const character = hud.characters[i];
      const [sx, sy] = character.shake(now);
      c.save();
      c.translate(i * (VIEW_W + VERSUS_GAP) + sx, sy);
      this.sheet = this.sheets[i];
      this.drawWell();
      this.drawStack(game);
      this.drawActive(game, i === 0);
      this.drawGarbageMeter(game);
      this.drawHold(game);
      this.drawQueue(game);
      this.drawVersusStats(game, i, hud);
      this.drawPopup(hud.popups[i]);
      this.drawStage(QUEUE_X, CHAR_Y, SIDE_W, CHAR_H);
      character.draw(c, QUEUE_X, CHAR_Y, SIDE_W, CHAR_H, now);
      if (hud.countdown) this.drawCenterText(hud.countdown);
      c.restore();
    });
    // Round clock between the boards; your board's tick, since online the opponent's lags a little.
    this.drawClock(match.players[0].tick);
    if (hud.banner) this.drawBanner(hud.banner);
    if (hud.status) this.drawStatus(hud.status);
  }

  /**
   * The phone layout: your board at full size with your character in the
   * left column; the opponent's board, name and character small on the right.
   */
  private drawVersusCompact(match: { readonly players: readonly [Game, Game] }, hud: VersusHud): void {
    const c = this.ctx;
    const now = performance.now();
    const [me, opp] = match.players;
    c.clearRect(0, 0, this.width, CANVAS_H);

    const [sx, sy] = hud.characters[0].shake(now);
    c.save();
    c.translate(sx, sy);
    this.sheet = this.sheets[0];
    this.drawWell();
    this.drawStack(me);
    this.drawActive(me, true);
    this.drawGarbageMeter(me);
    this.drawHold(me);
    this.drawQueue(me, COMPACT_QUEUE);
    this.drawVersusStats(me, 0, hud);
    this.drawStage(BOARD_X - SIDE_W - 16, MY_CHAR_Y, SIDE_W, MY_CHAR_H);
    hud.characters[0].draw(c, BOARD_X - SIDE_W - 16, MY_CHAR_Y, SIDE_W, MY_CHAR_H, now);
    this.drawPopup(hud.popups[0], COMPACT_POPUP_Y);
    if (hud.countdown) this.drawCenterText(hud.countdown);
    c.restore();

    // The opponent: name and round pips, a shrunken board, and their character.
    const [ox, oy] = hud.characters[1].shake(now);
    c.save();
    c.translate(ox, oy);
    const color = PLAYER_COLORS[1];
    c.fillStyle = color;
    c.font = `800 13px ${FONT}`;
    c.textAlign = 'left';
    c.fillText(fitText(c, hud.names[1], SIDE_W - 30), QUEUE_X, MINI_Y - 12);
    for (let r = 0; r < hud.roundsToWin; r++) {
      c.beginPath();
      c.arc(QUEUE_X + SIDE_W - 4 - (hud.roundsToWin - 1 - r) * 12, MINI_Y - 16, 4, 0, Math.PI * 2);
      c.fillStyle = r < hud.score[1] ? color : this.theme.panelBorder;
      c.fill();
    }
    c.save();
    c.translate(MINI_X - BOARD_X * MINI_SCALE, MINI_Y - BOARD_Y * MINI_SCALE);
    c.scale(MINI_SCALE, MINI_SCALE);
    // Only the visible rows: a spawning piece would run into the name above.
    c.beginPath();
    c.rect(METER_X - 2, BOARD_Y - 2, BOARD_X + BOARD_WIDTH * CELL - METER_X + 4, VISIBLE_HEIGHT * CELL + 4);
    c.clip();
    this.sheet = this.sheets[1];
    this.drawWell();
    this.drawStack(opp);
    this.drawActive(opp);
    this.drawGarbageMeter(opp);
    c.restore();
    this.drawStage(QUEUE_X, OPP_CHAR_Y, SIDE_W, OPP_CHAR_H);
    // The figure is drawn at a fixed size, so shrink it to fit the low stage.
    const k = Math.min(1, OPP_CHAR_H / 190);
    c.save();
    c.translate(QUEUE_X, OPP_CHAR_Y);
    c.scale(k, k);
    hud.characters[1].draw(c, 0, 0, SIDE_W / k, OPP_CHAR_H / k, now);
    c.restore();
    c.restore();

    this.drawClock(me.tick);
    if (hud.banner) this.drawBanner(hud.banner);
    if (hud.status) this.drawStatus(hud.status);
  }

  private drawClock(ticks: number): void {
    const c = this.ctx;
    const x = this.width / 2;
    // Above the names; a status line, when there is one, covers it.
    this.label('TIME', x, 16, 'center');
    c.fillStyle = this.theme.value;
    c.font = `700 22px ${FONT}`;
    c.textAlign = 'center';
    c.fillText(formatTime(ticks).slice(0, -2), x, 40);
  }

  /** The character's little stage, normally under the next queue. */
  private drawStage(x: number, y: number, w: number, h: number): void {
    const c = this.ctx;
    const [top, bottom] = this.theme.stage;
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    c.fillStyle = g;
    c.strokeStyle = this.theme.panelBorder;
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(x + 0.5, y + 0.5, w, h, 8);
    c.fill();
    c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.fillRect(x + 1, y + h - 14, w - 1, 14);
  }

  private drawStatus(text: string): void {
    const c = this.ctx;
    c.font = `700 15px ${FONT}`;
    c.textAlign = 'center';
    const w = c.measureText(text).width + 28;
    c.fillStyle = 'rgba(7,8,13,0.8)';
    c.fillRect(this.width / 2 - w / 2, 6, w, 26);
    c.fillStyle = '#ffd166';
    c.fillText(text, this.width / 2, 24);
  }

  /**
   * Red bar beside the board for garbage that can rise now, orange for
   * garbage still in its delay (the window to cancel it).
   */
  private drawGarbageMeter(game: Game): void {
    const tick = game.tick;
    const c = this.ctx;
    const bottom = BOARD_Y + VISIBLE_HEIGHT * CELL;
    c.fillStyle = this.theme.panel;
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
      c.fillStyle = r < hud.score[player] ? color : this.theme.panelBorder;
      c.fill();
    }

    let y = BOARD_Y + VISIBLE_HEIGHT * CELL - 130;
    const minutes = game.tick / TICK_RATE / 60;
    const rows: [string, string][] = [
      ['SENT', String(game.attackSent)],
      ['APM · ATTACK/MIN', minutes > 0 ? (game.attackSent / minutes).toFixed(1) : '0.0'],
      ['PPS · PIECES/SEC', minutes > 0 ? (game.piecesPlaced / (minutes * 60)).toFixed(2) : '0.00'],
    ];
    for (const [name, value] of rows) {
      this.label(name, right, y, 'right');
      c.fillStyle = this.theme.value;
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
    c.fillStyle = this.theme.well;
    c.fillRect(BOARD_X, BOARD_Y, w, h);
    c.strokeStyle = this.theme.grid;
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
    c.strokeStyle = this.theme.wellBorder;
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
        if (v) this.drawBlock(...this.cellPos(x, y), CELL, v, game.toppedOut ? 0.45 : 1);
      }
    }
  }

  /** The falling piece and its ghost; on your own board a tap-to-place spot replaces the ghost. */
  private drawActive(game: Game, mine = false): void {
    const ghost = game.ghost();
    const p = game.active;
    if (!p || !ghost) return;
    const tap = mine ? this.tapPreview : null;
    if (tap) this.drawTapPreview(tap);
    // The ghost keeps the standard look in every skin.
    else for (const [x, y] of game.pieceCells(ghost)) this.drawGhost(...this.cellPos(x, y), PIECE_COLORS[p.type]);
    const c = this.ctx;
    c.save();
    c.shadowColor = PIECE_COLORS[p.type];
    c.shadowBlur = 14;
    for (const [x, y] of game.pieceCells(p)) this.drawBlock(...this.cellPos(x, y), CELL, CELL_ID[p.type]);
    c.restore();
  }

  /** The picked spot: the piece half see-through, with a bright outline to tap again. */
  private drawTapPreview(tap: TapPreview): void {
    const c = this.ctx;
    for (const [x, y] of tap.cells) this.drawBlock(...this.cellPos(x, y), CELL, CELL_ID[tap.type], 0.5);
    c.save();
    c.strokeStyle = '#ffffff';
    c.lineWidth = 2;
    c.globalAlpha = 0.5 + 0.3 * Math.sin(performance.now() / 160);
    for (const [x, y] of tap.cells) {
      const [px, py] = this.cellPos(x, y);
      c.beginPath();
      c.roundRect(px + 2, py + 2, CELL - 4, CELL - 4, 5);
      c.stroke();
    }
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

  /** Cell `index` (1-7 pieces, 8 garbage) from the current side's skin. */
  private drawBlock(x: number, y: number, size: number, index: number, alpha = 1): void {
    const c = this.ctx;
    c.globalAlpha = alpha;
    drawCell(c, this.sheet, index, x, y, size);
    c.globalAlpha = 1;
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
      this.drawBlock(ox + (dx - minX) * MINI, oy + (-dy - minY) * MINI, MINI, dim ? 8 : CELL_ID[type], dim ? 0.5 : 1);
    }
  }

  private label(text: string, x: number, y: number, align: CanvasTextAlign = 'left'): void {
    const c = this.ctx;
    c.fillStyle = this.theme.label;
    c.font = `600 13px ${FONT}`;
    c.textAlign = align;
    c.textBaseline = 'alphabetic';
    c.fillText(t(text), x, y);
  }

  private panel(x: number, y: number, w: number, h: number): void {
    const c = this.ctx;
    c.fillStyle = this.theme.panel;
    c.strokeStyle = this.theme.panelBorder;
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

  private drawQueue(game: Game, shown = Infinity): void {
    const x = QUEUE_X;
    const y = BOARD_Y;
    this.label('NEXT', x, y - 8);
    const queue = game.queue.slice(0, shown);
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
      ['LINES', hud.goalLines ? `${Math.min(game.lines, hud.goalLines)}/${hud.goalLines}` : String(game.lines)],
      ['PIECES', `${game.piecesPlaced}  ·  ${pps.toFixed(2)}/s`],
      ['TIME', formatTime(game.tick)],
    ];
    for (const [name, value] of rows) {
      this.label(name, right, y, 'right');
      c.fillStyle = this.theme.value;
      c.font = `700 ${name === 'TIME' ? 30 : 22}px ${FONT}`;
      c.textAlign = 'right';
      c.fillText(value, right, y + (name === 'TIME' ? 34 : 28));
      y += name === 'TIME' ? 60 : 56;
    }
  }

  private drawPopup(popup: Popup | null, top = BOARD_Y + 150): void {
    if (!popup) return;
    const age = performance.now() - popup.at;
    if (age > 1600) return;
    const c = this.ctx;
    c.globalAlpha = age < 1200 ? 1 : 1 - (age - 1200) / 400;
    c.textAlign = 'right';
    const x = BOARD_X - 16;
    let y = top;
    popup.lines.forEach((line, i) => {
      c.fillStyle = i === 0 ? this.theme.value : '#9d86ff';
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

/** `text`, cut with an ellipsis to fit `max` pixels in the current font. */
function fitText(c: CanvasRenderingContext2D, text: string, max: number): string {
  if (c.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && c.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut}…`;
}
