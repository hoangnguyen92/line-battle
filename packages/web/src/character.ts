/**
 * The characters that stand beside each board and get hit by a falling
 * object when the opponent attacks. The object grows with the attack's lines
 * (before cancelling): apple, flowerpot, bowling ball, anvil, piano, cow, car.
 * The art lives in art.ts; this file is the animation.
 */
import type { CharacterId } from '@line-battle/engine';
import { characterImage, flatImage, objectImage, umbrellaImage, type Face, type HitObject } from './art';

export type { HitObject } from './art';

export function objectFor(lines: number): HitObject {
  if (lines <= 1) return 'apple';
  if (lines === 2) return 'flowerpot';
  if (lines === 3) return 'bowling';
  if (lines === 4) return 'anvil';
  if (lines <= 6) return 'piano';
  if (lines <= 9) return 'cow';
  return 'car';
}

interface Hit {
  object: HitObject;
  /** Every line was cancelled: the character blocks it with an umbrella. */
  blocked: boolean;
  at: number;
}

interface ObjectStyle {
  /** Drawn size in pixels. */
  size: number;
  /** How long the fall takes, in ms (the car falls in slow motion). */
  fall: number;
  /** How long the reaction lasts after impact, in ms. */
  react: number;
  /** Character height multiplier at the moment of impact. */
  squash: number;
  /** Screen shake strength in pixels. */
  shake: number;
}

const STYLES: Record<HitObject, ObjectStyle> = {
  apple: { size: 26, fall: 380, react: 500, squash: 0.92, shake: 0 },
  flowerpot: { size: 34, fall: 380, react: 650, squash: 0.85, shake: 0 },
  bowling: { size: 38, fall: 360, react: 900, squash: 1, shake: 0 },
  anvil: { size: 54, fall: 340, react: 1000, squash: 0.3, shake: 1.5 },
  piano: { size: 76, fall: 340, react: 1200, squash: 0.35, shake: 4 },
  cow: { size: 84, fall: 340, react: 1300, squash: 0.25, shake: 6 },
  car: { size: 112, fall: 900, react: 1800, squash: 0.15, shake: 8 },
};

/** How long an object takes to land, so the impact sound can wait for it. */
export function fallMs(object: HitObject): number {
  return STYLES[object].fall;
}

/** The character sprite's drawn size; its art is 100 x 120. */
const SPRITE_W = 96;
const SPRITE_H = 115;
/** Floor to the top of the head. */
const HEAD = 107;

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export class CharacterView {
  private hit: Hit | null = null;
  private koAt: number | null = null;
  private winAt: number | null = null;

  constructor(public character: CharacterId) {}

  /** The opponent attacked with `raw` lines; `blocked` when all of it was cancelled. */
  addHit(raw: number, blocked: boolean, now: number): void {
    if (raw <= 0 || this.koAt !== null) return;
    this.hit = { object: objectFor(raw), blocked, at: now };
  }

  knockOut(now: number): void {
    this.koAt ??= now;
  }

  /** The opponent topped out: a little victory jump. */
  celebrate(now: number): void {
    if (this.koAt === null) this.winAt ??= now;
  }

  reset(): void {
    this.hit = null;
    this.koAt = null;
    this.winAt = null;
  }

  /** Screen shake offset for this player's side right now. */
  shake(now: number): [number, number] {
    const h = this.hit;
    if (!h || h.blocked) return [0, 0];
    const style = STYLES[h.object];
    const t = now - h.at - style.fall;
    if (style.shake === 0 || t < 0 || t > 350) return [0, 0];
    const k = style.shake * (1 - t / 350);
    return [Math.sin(t * 0.09) * k, Math.cos(t * 0.11) * k * 0.6];
  }

  /** Draws the character standing on the floor of the box (x, y, w, h). */
  draw(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, now: number): void {
    const floor = y + h - 10;
    const cx = x + w / 2;
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();

    if (this.koAt !== null) {
      const t = now - this.koAt;
      // Topples over and lies flat; the feet slide right so the whole body stays on the stage.
      const p = Math.min(1, t / 350);
      this.drawFigure(c, cx + p * 52, floor - p * 24, { face: 'ko', squash: 1, tilt: p * (Math.PI / 2), lift: Math.sin(p * Math.PI) * 18 });
      if (t < 1600) drawStars(c, cx - 30, floor - 50, t);
      shout(c, 'K.O.', cx, y + 30, '#ff6b7a');
      c.restore();
      return;
    }

    if (this.winAt !== null) {
      const t = now - this.winAt;
      const jump = Math.abs(Math.sin(t / 180)) * 16;
      this.drawFigure(c, cx, floor, { face: 'win', squash: 1, tilt: 0, lift: jump });
      drawConfetti(c, x, y, w, t);
      c.restore();
      return;
    }

    const hit = this.hit;
    const style = hit ? STYLES[hit.object] : null;
    const t = hit ? now - hit.at : Infinity;
    if (!hit || !style || t > style.fall + style.react) {
      const blink = now % 3200 < 130;
      // A slow breath so the idle character feels alive.
      const breath = 1 + Math.sin(now / 520) * 0.012;
      this.drawFigure(c, cx, floor, { face: blink ? 'blink' : 'idle', squash: breath, tilt: 0 });
      c.restore();
      return;
    }

    const headTop = floor - HEAD;
    if (hit.blocked) {
      this.drawBlockedHit(c, hit.object, style, cx, y, floor, t);
      c.restore();
      return;
    }

    // Before impact the character looks up and the object falls; after it, the reaction plays.
    const after = t - style.fall;
    if (after < 0) {
      this.drawFigure(c, cx, floor, { face: 'look', squash: 1, tilt: 0 });
      const p = t / style.fall;
      const start = y - style.size;
      const end = headTop - style.size * 0.42;
      drawObject(c, hit.object, cx, start + (end - start) * p * p, style.size, p * 0.6);
      c.restore();
      return;
    }

    const r = after / style.react; // 0..1 through the reaction
    const recover = r < 0.55 ? 0 : (r - 0.55) / 0.45;
    const squash = style.squash + (1 - style.squash) * easeOutBack(recover);
    let tilt = 0;
    if (hit.object === 'bowling') tilt = (r < 0.6 ? 1 : 1 - (r - 0.6) / 0.4) * (Math.PI / 2.6);
    const flatTop = floor - HEAD * squash;
    const face: Face = after < style.react * 0.8 ? (style.react >= 900 ? 'dazed' : 'blink') : 'idle';

    if (style.shake >= 4) drawDust(c, cx, floor, after);
    if (hit.object === 'car' && r < 0.75) {
      // The car sits on the character: only the legs stick out from under it.
      const legs = flatImage(this.character);
      if (legs) c.drawImage(legs, cx - SPRITE_W / 2, floor - SPRITE_H + 4, SPRITE_W, SPRITE_H);
      const settle = Math.max(0, 1 - after / 160);
      drawObject(c, 'car', cx, floor - style.size * 0.4 - settle * 8, style.size, 0);
    } else {
      this.drawFigure(c, cx, floor, { face, squash, tilt });
      // The object bounces off and fades.
      const fade = Math.max(0, 1 - r * 1.6);
      if (fade > 0) {
        c.globalAlpha = fade;
        const side = hit.object === 'apple' || hit.object === 'flowerpot' || hit.object === 'bowling' ? 1 : 0;
        drawObject(c, hit.object, cx + side * r * 70, flatTop - style.size * 0.42 - side * Math.sin(r * Math.PI) * 34, style.size, side * r * 4);
        c.globalAlpha = 1;
      }
    }

    if (style.react >= 900 && r < 0.8) drawStars(c, cx, flatTop - 8, after);
    if (hit.object === 'piano') drawNotes(c, cx, flatTop, after);
    if (hit.object === 'cow' && r < 0.7) shout(c, 'MOO!', cx + 26, y + 28);
    if (hit.object === 'car' && r < 0.75) shout(c, 'CRASH!', cx, y + 28, '#ffd166');
    if (hit.object === 'flowerpot' && r < 0.6) drawDirt(c, cx, flatTop);
    if (hit.object === 'apple' && r < 0.5) shout(c, 'BONK', cx - 30, flatTop - 10, '#ffffff', 13);
    c.restore();
  }

  private drawBlockedHit(c: CanvasRenderingContext2D, object: HitObject, style: ObjectStyle, cx: number, top: number, floor: number, t: number): void {
    this.drawFigure(c, cx, floor, { face: 'look', squash: 1, tilt: 0 });
    const size = 92;
    const uy = floor - HEAD - 34;
    const umbrella = umbrellaImage();
    if (umbrella) c.drawImage(umbrella, cx - size / 2 + 6, uy - size * 0.3, size, size);
    const p = Math.min(1, t / style.fall);
    const land = uy - style.size * 0.5;
    if (p < 1) {
      const start = top - style.size;
      drawObject(c, object, cx, start + (land - start) * p * p, style.size, 0);
    } else {
      // Bounce off the umbrella to the side.
      const b = (t - style.fall) / 500;
      if (b < 1) {
        c.globalAlpha = 1 - b;
        drawObject(c, object, cx + b * 70, land - Math.sin(b * Math.PI) * 30 + b * b * 60, style.size, b * 3);
        c.globalAlpha = 1;
        shout(c, 'BLOCKED', cx, top + 28, '#8fd3ff');
      }
    }
  }

  private drawFigure(c: CanvasRenderingContext2D, cx: number, floor: number, o: { face: Face; squash: number; tilt: number; lift?: number }): void {
    const img = characterImage(this.character, o.face);
    if (!img) return;
    c.save();
    c.translate(cx, floor - (o.lift ?? 0));
    c.rotate(-o.tilt);
    // Squashing flattens and widens, like a cartoon.
    c.scale(1 + (1 - o.squash) * 0.7, o.squash);
    c.drawImage(img, -SPRITE_W / 2, -SPRITE_H, SPRITE_W, SPRITE_H);
    c.restore();
  }
}

function drawObject(c: CanvasRenderingContext2D, object: HitObject, cx: number, cy: number, size: number, spin: number): void {
  const img = objectImage(object);
  if (!img) return;
  c.save();
  c.translate(cx, cy);
  c.rotate(spin);
  c.drawImage(img, -size / 2, -size / 2, size, size);
  c.restore();
}

function drawStars(c: CanvasRenderingContext2D, cx: number, y: number, t: number): void {
  c.save();
  c.fillStyle = '#ffd84a';
  c.strokeStyle = '#1b1d2a';
  c.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const a = t / 220 + (i * Math.PI * 2) / 3;
    star(c, cx + Math.cos(a) * 26, y + Math.sin(a) * 7, 6);
  }
  c.restore();
}

function star(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
  c.stroke();
}

function drawNotes(c: CanvasRenderingContext2D, cx: number, y: number, t: number): void {
  c.save();
  c.fillStyle = '#c9b8ff';
  c.font = `700 20px ${FONT}`;
  c.textAlign = 'center';
  ['♪', '♫', '♪', '♬'].forEach((n, i) => {
    const p = (t / 900 + i * 0.25) % 1;
    c.globalAlpha = 1 - p;
    c.fillText(n, cx + (i - 1.5) * 26 + Math.sin(p * 6) * 6, y - 10 - p * 60);
  });
  c.restore();
}

function drawDirt(c: CanvasRenderingContext2D, cx: number, y: number): void {
  c.save();
  c.fillStyle = '#6b4a2f';
  for (const [dx, dy, r] of [[-10, 4, 4], [0, 0, 5], [10, 4, 3.5], [5, 8, 3]]) {
    c.beginPath();
    c.arc(cx + dx, y + dy, r, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

/** Puffs of dust from the floor on a heavy landing. */
function drawDust(c: CanvasRenderingContext2D, cx: number, floor: number, t: number): void {
  if (t > 500) return;
  const p = t / 500;
  c.save();
  c.globalAlpha = 0.55 * (1 - p);
  c.fillStyle = '#c9c3b6';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.arc(cx + side * (34 + p * 30 + i * 12), floor - 6 - i * 3 - p * 8, 7 + p * 6 - i * 1.5, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();
}

const CONFETTI = ['#ff6b7a', '#ffd166', '#7ddc8a', '#5ff3ff', '#c9b8ff'];

function drawConfetti(c: CanvasRenderingContext2D, x: number, y: number, w: number, t: number): void {
  c.save();
  for (let i = 0; i < 18; i++) {
    const fall = ((t / 1400 + i * 0.137) % 1) * 1.1;
    const px = x + ((i * 53) % w) + Math.sin(t / 300 + i) * 6;
    const py = y + fall * 200 - 10;
    c.fillStyle = CONFETTI[i % CONFETTI.length];
    c.save();
    c.translate(px, py);
    c.rotate(t / 200 + i);
    c.fillRect(-3, -1.5, 6, 3);
    c.restore();
  }
  c.restore();
}

function shout(c: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#ffffff', size = 18): void {
  c.save();
  c.font = `900 ${size}px ${FONT}`;
  c.textAlign = 'center';
  c.lineWidth = 4;
  c.lineJoin = 'round';
  c.strokeStyle = '#07080d';
  c.strokeText(text, x, y);
  c.fillStyle = color;
  c.fillText(text, x, y);
  c.restore();
}

function easeOutBack(t: number): number {
  const k = 1.70158;
  return 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
}

/** Lightens (amount > 0) or darkens (amount < 0) a #rrggbb colour. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (v: number) => Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  const r = mix(n >> 16), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `rgb(${r},${g},${b})`;
}
