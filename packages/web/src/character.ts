/**
 * Placeholder characters that stand beside each board and get hit by a falling
 * object when the opponent attacks. The object grows with the attack's lines
 * (before cancelling): apple, flowerpot, bowling ball, anvil, piano, cow, car.
 * Real art and animation replace these shapes in phase 6.
 */

export type HitObject = 'apple' | 'flowerpot' | 'bowling' | 'anvil' | 'piano' | 'cow' | 'car';

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
  apple: { size: 16, fall: 380, react: 500, squash: 0.92, shake: 0 },
  flowerpot: { size: 22, fall: 380, react: 650, squash: 0.85, shake: 0 },
  bowling: { size: 26, fall: 360, react: 900, squash: 1, shake: 0 },
  anvil: { size: 36, fall: 340, react: 1000, squash: 0.3, shake: 1.5 },
  piano: { size: 54, fall: 340, react: 1200, squash: 0.35, shake: 4 },
  cow: { size: 60, fall: 340, react: 1300, squash: 0.25, shake: 6 },
  car: { size: 80, fall: 900, react: 1800, squash: 0.15, shake: 8 },
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export class CharacterView {
  private hit: Hit | null = null;
  private koAt: number | null = null;

  constructor(readonly color: string) {}

  /** The opponent attacked with `raw` lines; `blocked` when all of it was cancelled. */
  addHit(raw: number, blocked: boolean, now: number): void {
    if (raw <= 0 || this.koAt !== null) return;
    this.hit = { object: objectFor(raw), blocked, at: now };
  }

  knockOut(now: number): void {
    this.koAt ??= now;
  }

  reset(): void {
    this.hit = null;
    this.koAt = null;
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
    const floor = y + h - 14;
    const cx = x + w / 2;
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();

    c.strokeStyle = '#2b2f45';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x + 8, floor + 1);
    c.lineTo(x + w - 8, floor + 1);
    c.stroke();

    if (this.koAt !== null) {
      this.drawFigure(c, cx, floor, { squash: 1, tilt: Math.min(1, (now - this.koAt) / 300) * (Math.PI / 2), ko: true });
      c.fillStyle = '#ff6b7a';
      c.font = `900 22px ${FONT}`;
      c.textAlign = 'center';
      c.fillText('K.O.', cx, y + 30);
      c.restore();
      return;
    }

    const hit = this.hit;
    const style = hit ? STYLES[hit.object] : null;
    const t = hit ? now - hit.at : Infinity;
    if (!hit || !style || t > style.fall + style.react) {
      this.drawFigure(c, cx, floor, { squash: 1, tilt: 0, blink: Math.floor(now / 2600) % 6 === 0 && now % 2600 < 140 });
      c.restore();
      return;
    }

    const headTop = floor - 92;
    if (hit.blocked) {
      this.drawBlockedHit(c, hit.object, style, cx, y, headTop, t);
      c.restore();
      return;
    }

    // Before impact the character idles and the object falls; after it, the reaction plays.
    const after = t - style.fall;
    if (after < 0) {
      this.drawFigure(c, cx, floor, { squash: 1, tilt: 0, lookUp: true });
      const p = t / style.fall;
      const oy = y - style.size + (headTop - (y - style.size)) * p * p;
      drawObject(c, hit.object, cx, oy, style.size);
      c.restore();
      return;
    }

    const r = after / style.react; // 0..1 through the reaction
    const recover = r < 0.55 ? 0 : (r - 0.55) / 0.45;
    const squash = style.squash + (1 - style.squash) * easeOutBack(recover);
    let tilt = 0;
    if (hit.object === 'bowling') tilt = (r < 0.6 ? 1 : 1 - (r - 0.6) / 0.4) * (Math.PI / 2.8);
    const flatTop = floor - 92 * squash;

    if (hit.object === 'car' && r < 0.75) {
      // The car sits on the character: only the legs stick out from under it.
      drawLegsUnder(c, cx, floor, this.color);
      drawObject(c, 'car', cx, floor - style.size * 0.55, style.size);
    } else {
      this.drawFigure(c, cx, floor, { squash, tilt, dazed: after < style.react * 0.8 });
      // The object bounces off and fades.
      const fade = Math.max(0, 1 - r * 1.6);
      if (fade > 0) {
        c.globalAlpha = fade;
        const side = hit.object === 'apple' || hit.object === 'flowerpot' ? 1 : 0;
        drawObject(c, hit.object, cx + side * r * 60, flatTop - style.size * 0.5 - side * Math.sin(r * Math.PI) * 30, style.size);
        c.globalAlpha = 1;
      }
    }

    if (style.react >= 900 && r < 0.8) drawStars(c, cx, flatTop - 10, after);
    if (hit.object === 'piano') drawNotes(c, cx, flatTop, after);
    if (hit.object === 'cow' && r < 0.7) shout(c, 'MOO!', cx + 30, y + 26);
    if (hit.object === 'car' && r < 0.75) shout(c, 'CRASH!', cx, y + 26);
    if (hit.object === 'flowerpot' && r < 0.6) drawDirt(c, cx, flatTop);
    c.restore();
  }

  private drawBlockedHit(c: CanvasRenderingContext2D, object: HitObject, style: ObjectStyle, cx: number, top: number, headTop: number, t: number): void {
    const floor = headTop + 92;
    this.drawFigure(c, cx, floor, { squash: 1, tilt: 0, lookUp: true });
    const umbrellaY = headTop - 18;
    drawUmbrella(c, cx, umbrellaY, floor);
    const p = Math.min(1, t / style.fall);
    if (p < 1) {
      const oy = top - style.size + (umbrellaY - style.size * 0.6 - (top - style.size)) * p * p;
      drawObject(c, object, cx, oy, style.size);
    } else {
      // Bounce off the umbrella to the side.
      const b = (t - style.fall) / 500;
      if (b < 1) {
        c.globalAlpha = 1 - b;
        drawObject(c, object, cx + b * 70, umbrellaY - style.size * 0.6 - Math.sin(b * Math.PI) * 30 + b * b * 60, style.size);
        c.globalAlpha = 1;
        shout(c, 'BLOCKED', cx, top + 26, '#8fd3ff');
      }
    }
  }

  private drawFigure(
    c: CanvasRenderingContext2D,
    cx: number,
    floor: number,
    o: { squash: number; tilt: number; ko?: boolean; dazed?: boolean; blink?: boolean; lookUp?: boolean },
  ): void {
    c.save();
    c.translate(cx, floor);
    c.rotate(-o.tilt);
    c.scale(1 + (1 - o.squash) * 0.6, o.squash);
    // Legs
    c.strokeStyle = shade(this.color, -0.4);
    c.lineWidth = 6;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-9, -24);
    c.lineTo(-11, -2);
    c.moveTo(9, -24);
    c.lineTo(11, -2);
    c.stroke();
    // Body
    c.fillStyle = this.color;
    c.beginPath();
    c.roundRect(-20, -62, 40, 42, 14);
    c.fill();
    // Head
    c.fillStyle = '#f2d4b6';
    c.beginPath();
    c.arc(0, -76, 17, 0, Math.PI * 2);
    c.fill();
    // Face
    c.strokeStyle = '#20222e';
    c.fillStyle = '#20222e';
    c.lineWidth = 2;
    const eyeY = o.lookUp ? -81 : -78;
    if (o.ko || o.dazed) {
      for (const ex of [-6, 6]) {
        c.beginPath();
        c.moveTo(ex - 3, eyeY - 3);
        c.lineTo(ex + 3, eyeY + 3);
        c.moveTo(ex + 3, eyeY - 3);
        c.lineTo(ex - 3, eyeY + 3);
        c.stroke();
      }
    } else if (o.blink) {
      c.beginPath();
      c.moveTo(-9, eyeY);
      c.lineTo(-3, eyeY);
      c.moveTo(3, eyeY);
      c.lineTo(9, eyeY);
      c.stroke();
    } else {
      for (const ex of [-6, 6]) {
        c.beginPath();
        c.arc(ex, eyeY, 2.4, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.beginPath();
    if (o.ko || o.dazed) c.arc(0, -66, 4, Math.PI * 1.15, Math.PI * 1.85);
    else c.arc(0, -71, 5, Math.PI * 0.15, Math.PI * 0.85);
    c.stroke();
    c.restore();
  }
}

function drawObject(c: CanvasRenderingContext2D, object: HitObject, cx: number, cy: number, size: number): void {
  const s = size;
  c.save();
  c.translate(cx, cy);
  switch (object) {
    case 'apple':
      c.fillStyle = '#e8404c';
      c.beginPath();
      c.arc(0, 0, s / 2, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#4caf50';
      c.beginPath();
      c.ellipse(s * 0.2, -s * 0.55, s * 0.22, s * 0.1, -0.5, 0, Math.PI * 2);
      c.fill();
      break;
    case 'flowerpot':
      c.fillStyle = '#c96a3c';
      c.beginPath();
      c.moveTo(-s / 2, -s * 0.2);
      c.lineTo(s / 2, -s * 0.2);
      c.lineTo(s * 0.35, s / 2);
      c.lineTo(-s * 0.35, s / 2);
      c.closePath();
      c.fill();
      c.fillStyle = '#5ccb4a';
      c.beginPath();
      c.ellipse(0, -s * 0.4, s * 0.3, s * 0.25, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#ff7ab8';
      c.beginPath();
      c.arc(0, -s * 0.55, s * 0.13, 0, Math.PI * 2);
      c.fill();
      break;
    case 'bowling':
      c.fillStyle = '#2b3a8f';
      c.beginPath();
      c.arc(0, 0, s / 2, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#0d1230';
      for (const [hx, hy] of [[-0.12, -0.15], [0.08, -0.2], [-0.02, 0.02]]) {
        c.beginPath();
        c.arc(hx * s, hy * s, s * 0.06, 0, Math.PI * 2);
        c.fill();
      }
      break;
    case 'anvil':
      c.fillStyle = '#7d8295';
      c.beginPath();
      c.moveTo(-s / 2, -s * 0.3);
      c.lineTo(s / 2, -s * 0.3);
      c.lineTo(s * 0.3, -s * 0.05);
      c.lineTo(s * 0.15, s * 0.05);
      c.lineTo(s * 0.3, s * 0.3);
      c.lineTo(-s * 0.3, s * 0.3);
      c.lineTo(-s * 0.15, s * 0.05);
      c.lineTo(-s * 0.3, -s * 0.05);
      c.closePath();
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.fillRect(-s / 2, -s * 0.3, s, s * 0.07);
      break;
    case 'piano': {
      c.fillStyle = '#14151c';
      c.fillRect(-s / 2, -s * 0.35, s, s * 0.7);
      c.fillStyle = '#f4f4f4';
      const keys = 8;
      const kw = (s * 0.9) / keys;
      for (let i = 0; i < keys; i++) c.fillRect(-s * 0.45 + i * kw + 0.5, s * 0.05, kw - 1, s * 0.22);
      c.fillStyle = '#14151c';
      for (const i of [1, 2, 4, 5, 6]) c.fillRect(-s * 0.45 + i * kw - kw * 0.25, s * 0.05, kw * 0.5, s * 0.13);
      break;
    }
    case 'cow':
      c.fillStyle = '#f4f4f4';
      c.beginPath();
      c.roundRect(-s / 2, -s * 0.25, s * 0.8, s * 0.45, s * 0.12);
      c.fill();
      c.fillStyle = '#20222e';
      c.beginPath();
      c.ellipse(-s * 0.25, -s * 0.05, s * 0.1, s * 0.08, 0.4, 0, Math.PI * 2);
      c.ellipse(s * 0.05, s * 0.05, s * 0.09, s * 0.07, -0.3, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#f4f4f4';
      c.beginPath();
      c.arc(s * 0.38, -s * 0.2, s * 0.15, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#ffb3c1';
      c.beginPath();
      c.ellipse(s * 0.47, -s * 0.14, s * 0.07, s * 0.05, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#f4f4f4';
      c.lineWidth = s * 0.07;
      c.beginPath();
      for (const lx of [-0.4, -0.15, 0.05, 0.22]) {
        c.moveTo(lx * s, s * 0.2);
        c.lineTo(lx * s, s * 0.35);
      }
      c.stroke();
      break;
    case 'car':
      c.fillStyle = '#e64a55';
      c.beginPath();
      c.roundRect(-s / 2, -s * 0.12, s, s * 0.3, s * 0.06);
      c.fill();
      c.beginPath();
      c.roundRect(-s * 0.28, -s * 0.34, s * 0.52, s * 0.26, s * 0.08);
      c.fill();
      c.fillStyle = '#9fd8ff';
      c.fillRect(-s * 0.22, -s * 0.29, s * 0.18, s * 0.16);
      c.fillRect(s * 0.02, -s * 0.29, s * 0.17, s * 0.16);
      c.fillStyle = '#16171f';
      for (const wx of [-0.3, 0.3]) {
        c.beginPath();
        c.arc(wx * s, s * 0.2, s * 0.1, 0, Math.PI * 2);
        c.fill();
      }
      break;
  }
  c.restore();
}

function drawLegsUnder(c: CanvasRenderingContext2D, cx: number, floor: number, color: string): void {
  c.save();
  c.strokeStyle = shade(color, -0.4);
  c.lineWidth = 6;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(cx - 6, floor - 4);
  c.lineTo(cx - 34, floor - 2);
  c.moveTo(cx + 6, floor - 4);
  c.lineTo(cx + 36, floor - 6);
  c.stroke();
  c.restore();
}

function drawUmbrella(c: CanvasRenderingContext2D, cx: number, top: number, floor: number): void {
  c.save();
  c.strokeStyle = '#c7c9d6';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(cx + 22, top);
  c.lineTo(cx + 22, floor - 40);
  c.stroke();
  c.fillStyle = '#4f8cff';
  c.beginPath();
  c.arc(cx + 22, top + 4, 34, Math.PI, 0);
  c.closePath();
  c.fill();
  c.restore();
}

function drawStars(c: CanvasRenderingContext2D, cx: number, y: number, t: number): void {
  c.save();
  c.fillStyle = '#ffd84a';
  for (let i = 0; i < 3; i++) {
    const a = t / 220 + (i * Math.PI * 2) / 3;
    star(c, cx + Math.cos(a) * 24, y + Math.sin(a) * 6, 5);
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
}

function drawNotes(c: CanvasRenderingContext2D, cx: number, y: number, t: number): void {
  c.save();
  c.fillStyle = '#c9b8ff';
  c.font = `700 18px ${FONT}`;
  c.textAlign = 'center';
  ['♪', '♫', '♪'].forEach((n, i) => {
    const p = (t / 900 + i * 0.3) % 1;
    c.globalAlpha = 1 - p;
    c.fillText(n, cx + (i - 1) * 30 + Math.sin(p * 6) * 6, y - 10 - p * 60);
  });
  c.restore();
}

function drawDirt(c: CanvasRenderingContext2D, cx: number, y: number): void {
  c.save();
  c.fillStyle = '#6b4a2f';
  for (const [dx, dy, r] of [[-8, 2, 4], [2, -1, 5], [9, 3, 3]]) {
    c.beginPath();
    c.arc(cx + dx, y + dy, r, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

function shout(c: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#ffffff'): void {
  c.save();
  c.font = `900 18px ${FONT}`;
  c.textAlign = 'center';
  c.lineWidth = 4;
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
