import { PIECE_TYPES, type PieceType, type SkinId, type ThemeId } from '@line-battle/engine';

/**
 * Block skins and board themes. A skin is a sheet of 9 cell images: index 0
 * unused, 1-7 the pieces in CELL_ID order, 8 garbage. The renderer only ever
 * copies cells from a sheet, so a skin drawn as a PNG by an artist slots in
 * the same way as these drawn ones.
 *
 * Fairness rules: every skin keeps each piece's usual hue so the 7 stay easy
 * to tell apart, and garbage always uses the standard look.
 */

export const PIECE_COLORS: Record<PieceType, string> = {
  I: '#35c8de',
  J: '#4069e6',
  L: '#ee8a2f',
  O: '#eecb3a',
  S: '#5ccb4a',
  T: '#a650e0',
  Z: '#e64a55',
};
const GARBAGE_COLOR = '#6b6f82';

/** Pixels per cell in a sheet; drawn smaller on screen, so it stays sharp on high-DPI screens. */
const SHEET_CELL = 64;

export interface SkinSheet {
  id: SkinId;
  canvas: HTMLCanvasElement;
}

type DrawCell = (c: CanvasRenderingContext2D, s: number, color: string, index: number) => void;

/** Lightens (amount > 0) or darkens (amount < 0) a #rrggbb colour. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (v: number) => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  return `rgb(${mix(n >> 16)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/** The original bevelled gem block; also the standard garbage look. */
const gem: DrawCell = (c, s, color) => {
  const g = 2, r = s * 0.16, b = s - g * 2;
  const body = c.createLinearGradient(0, g, 0, g + b);
  body.addColorStop(0, shade(color, 0.25));
  body.addColorStop(0.5, color);
  body.addColorStop(1, shade(color, -0.35));
  rounded(c, g, g, b, b, r);
  c.fillStyle = body;
  c.fill();
  const inset = b * 0.16;
  const face = c.createLinearGradient(0, g + inset, 0, g + b - inset);
  face.addColorStop(0, shade(color, 0.12));
  face.addColorStop(1, shade(color, -0.12));
  rounded(c, g + inset, g + inset, b - inset * 2, b - inset * 2, r * 0.6);
  c.fillStyle = face;
  c.fill();
  const gloss = c.createLinearGradient(0, g, 0, g + b * 0.55);
  gloss.addColorStop(0, 'rgba(255,255,255,0.45)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  c.beginPath();
  c.roundRect(g + 2, g + 2, b - 4, b * 0.5, [r, r, r * 0.3, r * 0.3]);
  c.fillStyle = gloss;
  c.fill();
  rounded(c, g + 1, g + 1, b - 2, b - 2, r);
  c.strokeStyle = shade(color, -0.55);
  c.lineWidth = 2;
  c.stroke();
};

const flat: DrawCell = (c, s, color) => {
  c.fillStyle = color;
  c.fillRect(2, 2, s - 4, s - 4);
  c.strokeStyle = shade(color, -0.3);
  c.lineWidth = 4;
  c.strokeRect(4, 4, s - 8, s - 8);
};

const glossy: DrawCell = (c, s, color) => {
  const body = c.createRadialGradient(s * 0.35, s * 0.3, s * 0.05, s / 2, s / 2, s * 0.75);
  body.addColorStop(0, shade(color, 0.45));
  body.addColorStop(0.6, color);
  body.addColorStop(1, shade(color, -0.45));
  rounded(c, 2, 2, s - 4, s - 4, s * 0.3);
  c.fillStyle = body;
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.7)';
  c.beginPath();
  c.ellipse(s * 0.36, s * 0.26, s * 0.18, s * 0.09, -0.5, 0, Math.PI * 2);
  c.fill();
};

/** 8 x 8 pixel art: a light top-left edge, a dark bottom-right edge. */
const pixel: DrawCell = (c, s, color) => {
  const p = s / 8;
  const light = shade(color, 0.4), dark = shade(color, -0.45);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let fill = color;
      if (x === 7 || y === 7) fill = dark;
      else if (x === 0 || y === 0) fill = light;
      else if ((x === 1 && y === 1) || (x === 2 && y === 1) || (x === 1 && y === 2)) fill = '#ffffff';
      c.fillStyle = fill;
      c.fillRect(x * p, y * p, Math.ceil(p), Math.ceil(p));
    }
  }
};

const neon: DrawCell = (c, s, color) => {
  c.fillStyle = shade(color, -0.82);
  rounded(c, 3, 3, s - 6, s - 6, 8);
  c.fill();
  c.shadowColor = color;
  c.shadowBlur = 12;
  c.strokeStyle = shade(color, 0.25);
  c.lineWidth = 5;
  rounded(c, 6, 6, s - 12, s - 12, 7);
  c.stroke();
  c.shadowBlur = 0;
  c.strokeStyle = shade(color, 0.7);
  c.lineWidth = 2;
  c.stroke();
};

const candy: DrawCell = (c, s, color) => {
  const base = shade(color, 0.35);
  rounded(c, 2, 2, s - 4, s - 4, s * 0.22);
  c.fillStyle = base;
  c.fill();
  c.save();
  c.clip();
  c.strokeStyle = 'rgba(255,255,255,0.45)';
  c.lineWidth = s * 0.1;
  for (let k = -s; k < s * 2; k += s * 0.28) {
    c.beginPath();
    c.moveTo(k, 0);
    c.lineTo(k + s, s);
    c.stroke();
  }
  c.restore();
  rounded(c, 3, 3, s - 6, s - 6, s * 0.22);
  c.strokeStyle = shade(color, -0.2);
  c.lineWidth = 4;
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.beginPath();
  c.ellipse(s * 0.3, s * 0.24, s * 0.12, s * 0.06, -0.4, 0, Math.PI * 2);
  c.fill();
};

const stone: DrawCell = (c, s, color, index) => {
  const body = c.createLinearGradient(0, 0, s, s);
  body.addColorStop(0, shade(color, 0.05));
  body.addColorStop(1, shade(color, -0.4));
  c.fillStyle = body;
  c.fillRect(2, 2, s - 4, s - 4);
  // Fixed speckles per piece, so the sheet looks the same every time.
  let seed = 1234 + index * 977;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    c.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.14)';
    c.fillRect(4 + rand() * (s - 10), 4 + rand() * (s - 10), 2 + rand() * 3, 2 + rand() * 3);
  }
  // Chiselled edges.
  c.fillStyle = 'rgba(255,255,255,0.28)';
  c.beginPath();
  c.moveTo(2, 2); c.lineTo(s - 2, 2); c.lineTo(s - 9, 9); c.lineTo(9, 9); c.lineTo(9, s - 9); c.lineTo(2, s - 2);
  c.fill();
  c.fillStyle = 'rgba(0,0,0,0.3)';
  c.beginPath();
  c.moveTo(s - 2, s - 2); c.lineTo(2, s - 2); c.lineTo(9, s - 9); c.lineTo(s - 9, s - 9); c.lineTo(s - 9, 9); c.lineTo(s - 2, 2);
  c.fill();
};

/** Earned only: the piece's colour set in a gold frame. */
const gold: DrawCell = (c, s, color) => {
  const frame = c.createLinearGradient(0, 0, s, s);
  frame.addColorStop(0, '#fff3b0');
  frame.addColorStop(0.45, '#e2b23a');
  frame.addColorStop(1, '#8a5a12');
  rounded(c, 2, 2, s - 4, s - 4, 8);
  c.fillStyle = frame;
  c.fill();
  const inner = c.createLinearGradient(0, 10, 0, s - 10);
  inner.addColorStop(0, shade(color, 0.3));
  inner.addColorStop(1, shade(color, -0.3));
  rounded(c, 10, 10, s - 20, s - 20, 5);
  c.fillStyle = inner;
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.beginPath();
  c.moveTo(14, 14); c.lineTo(s * 0.5, 14); c.lineTo(14, s * 0.5);
  c.fill();
};

const DRAW: Record<SkinId, DrawCell> = { gem, flat, glossy, pixel, neon, candy, stone, gold };

const sheets = new Map<SkinId, SkinSheet>();

/** The sheet for a skin, drawn the first time it's asked for. */
export function skinSheet(id: SkinId): SkinSheet {
  let sheet = sheets.get(id);
  if (sheet) return sheet;
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_CELL * 9;
  canvas.height = SHEET_CELL;
  const c = canvas.getContext('2d')!;
  const colors = ['', ...PIECE_TYPES.map((t) => PIECE_COLORS[t])];
  colors.forEach((color, i) => {
    if (!color) return;
    c.save();
    c.translate(i * SHEET_CELL, 0);
    DRAW[id](c, SHEET_CELL, color, i);
    c.restore();
  });
  // Garbage keeps the standard look in every skin.
  c.save();
  c.translate(8 * SHEET_CELL, 0);
  gem(c, SHEET_CELL, GARBAGE_COLOR, 8);
  c.restore();
  sheet = { id, canvas };
  sheets.set(id, sheet);
  return sheet;
}

/** Copies cell `index` (1-7 pieces, 8 garbage) of a sheet to the screen. */
export function drawCell(c: CanvasRenderingContext2D, sheet: SkinSheet, index: number, x: number, y: number, size: number): void {
  c.drawImage(sheet.canvas, index * SHEET_CELL, 0, SHEET_CELL, SHEET_CELL, x, y, size, size);
}

/** Colours for everything around the blocks. */
export interface Theme {
  id: ThemeId;
  /** The page behind the canvas. */
  page: string;
  well: string;
  grid: string;
  wellBorder: string;
  panel: string;
  panelBorder: string;
  label: string;
  value: string;
  /** Behind the character, under the next queue. */
  stage: [string, string];
}

export const THEME_COLORS: Record<ThemeId, Theme> = {
  night: {
    id: 'night', page: '#0e0f16', well: '#07080d', grid: '#1a1c29', wellBorder: '#3a3e57',
    panel: '#111320', panelBorder: '#262a3d', label: '#8b8fa8', value: '#e8e9f1', stage: ['#151830', '#111320'],
  },
  ocean: {
    id: 'ocean', page: '#06202e', well: '#03131d', grid: '#0c2a3a', wellBorder: '#2d6d8a',
    panel: '#082636', panelBorder: '#174a60', label: '#7fb4c9', value: '#e3f6ff', stage: ['#0b4560', '#082636'],
  },
  sakura: {
    id: 'sakura', page: '#2a1724', well: '#170b14', grid: '#2e1a28', wellBorder: '#8a4a72',
    panel: '#25131f', panelBorder: '#4f2a43', label: '#d7a3c4', value: '#ffeaf6', stage: ['#5a2d4a', '#25131f'],
  },
  paper: {
    id: 'paper', page: '#e9e2d3', well: '#1d1f2a', grid: '#2a2d3b', wellBorder: '#5b5545',
    panel: '#f6f1e6', panelBorder: '#c9bfa8', label: '#7a705c', value: '#2b2618', stage: ['#cfe6f7', '#f6f1e6'],
  },
};
