import { KEYS, type Key, type KeyMap } from '@line-battle/engine';
import { t } from './i18n';

/** The made-up key code a touch button presses, bound like a real key. */
export function touchCode(key: Key): string {
  return `Touch:${key}`;
}

export type TouchMode = 'auto' | 'on' | 'off';

/** Phones and tablets: no mouse to hover with, and a finger to point with. */
export function isTouchDevice(): boolean {
  try {
    return matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Wide enough that the buttons go either side of the board instead of under it. */
export function isLandscape(): boolean {
  return innerWidth > innerHeight * 1.25;
}

interface ButtonSpec {
  key: Key;
  icon: string;
  label: string;
  /** Wider than one cell. */
  wide?: boolean;
}

// Left thumb moves and holds; right thumb rotates and drops.
const LEFT: ButtonSpec[] = [
  { key: 'hold', icon: 'HOLD', label: 'Hold' },
  { key: 'softDrop', icon: '▼', label: 'Soft drop' },
  { key: 'left', icon: '◀', label: 'Move left' },
  { key: 'right', icon: '▶', label: 'Move right' },
];
const RIGHT: ButtonSpec[] = [
  { key: 'rotateCCW', icon: '↺', label: 'Rotate counter-clockwise' },
  { key: 'rotateCW', icon: '↻', label: 'Rotate clockwise' },
  { key: 'rotate180', icon: '180', label: 'Rotate 180' },
  { key: 'hardDrop', icon: '⤓', label: 'Hard drop' },
];

const SWIPE_LABELS: Record<Key, string> = {
  left: 'drag left',
  right: 'drag right',
  softDrop: 'drag down',
  hardDrop: 'flick down',
  rotateCW: 'tap the right side',
  rotateCCW: 'tap the left side',
  rotate180: 'the 180 button',
  hold: 'flick up',
};

const TAP_LABELS: Record<Key, string> = {
  left: 'tapping a spot',
  right: 'tapping a spot',
  softDrop: '⤓',
  hardDrop: '⤓',
  rotateCW: '↻',
  rotateCCW: '↺',
  rotate180: '↻↻',
  hold: 'HOLD',
};

/** Which controls text about keys should describe. */
let labelStyle: TouchStyle = 'swipe';

export function setLabelStyle(style: TouchStyle): void {
  labelStyle = style;
}

/** How to do an action by touch, by its made-up key code, e.g. for the tutorial's text. */
export function touchLabel(code: string): string | undefined {
  const spec = [...LEFT, ...RIGHT].find((s) => touchCode(s.key) === code);
  if (!spec) return undefined;
  if (labelStyle === 'swipe') return t(SWIPE_LABELS[spec.key]);
  if (labelStyle === 'tap') return t(TAP_LABELS[spec.key]);
  return spec.icon;
}

/** A key map of the touch buttons alone, so text about keys names the buttons instead. */
export function touchKeyMap(): KeyMap {
  return Object.fromEntries(KEYS.map((k) => [k, [touchCode(k)]])) as KeyMap;
}

/**
 * On-screen buttons for phones. A finger can slide from one button to the
 * next (left to right, say) without lifting, and several fingers work at
 * once. Each press goes to `down`/`up` as a key code from touchCode().
 */
export class TouchPad {
  readonly root: HTMLElement;
  private buttons = new Map<HTMLElement, Key>();
  /** The button each finger is on. */
  private fingers = new Map<number, Key | null>();
  /** How many fingers are on each button, so lifting one of two keeps it held. */
  private held = new Map<Key, number>();

  constructor(
    parent: HTMLElement,
    private down: (code: string, key: Key) => void,
    private up: (code: string) => void,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'touchpad';
    this.root.className = 'touchpad hidden';
    for (const [side, specs] of [['left', LEFT], ['right', RIGHT]] as const) {
      const cluster = document.createElement('div');
      cluster.className = `touch-cluster ${side}`;
      for (const s of specs) {
        const b = document.createElement('div');
        b.className = `touch-btn ${s.key}`;
        b.textContent = s.icon;
        b.setAttribute('role', 'button');
        b.setAttribute('aria-label', t(s.label));
        this.buttons.set(b, s.key);
        cluster.append(b);
      }
      this.root.append(cluster);
    }
    parent.append(this.root);

    const opts = { passive: false } as const;
    this.root.addEventListener('pointerdown', (e) => this.move(e), opts);
    this.root.addEventListener('pointermove', (e) => this.fingers.has(e.pointerId) && this.move(e), opts);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.root.addEventListener(type, (e) => this.lift(e.pointerId));
    }
    // No long-press menu, text selection or double-tap zoom on the buttons.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  setVisible(on: boolean): void {
    if (on === this.visible) return;
    if (!on) this.releaseAll();
    this.root.classList.toggle('hidden', !on);
  }

  /** Lets go of every button, e.g. when play stops. */
  releaseAll(): void {
    for (const id of [...this.fingers.keys()]) this.lift(id);
  }

  private move(e: PointerEvent): void {
    e.preventDefault();
    // Keep getting this finger's moves even once it leaves the button it started on.
    if (e.type === 'pointerdown') this.root.setPointerCapture?.(e.pointerId);
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const key = el instanceof HTMLElement ? (this.buttons.get(el) ?? null) : null;
    const was = this.fingers.get(e.pointerId) ?? null;
    this.fingers.set(e.pointerId, key);
    if (key === was) return;
    if (was) this.release(was);
    if (key) this.press(key);
  }

  private lift(pointerId: number): void {
    const was = this.fingers.get(pointerId);
    this.fingers.delete(pointerId);
    if (was) this.release(was);
  }

  private press(key: Key): void {
    const n = this.held.get(key) ?? 0;
    this.held.set(key, n + 1);
    if (n > 0) return;
    this.buttonFor(key)?.classList.add('pressed');
    try {
      navigator.vibrate?.(8);
    } catch {
      /* no buzz on this phone */
    }
    this.down(touchCode(key), key);
  }

  private release(key: Key): void {
    const n = (this.held.get(key) ?? 0) - 1;
    if (n > 0) return void this.held.set(key, n);
    this.held.delete(key);
    this.buttonFor(key)?.classList.remove('pressed');
    this.up(touchCode(key));
  }

  private buttonFor(key: Key): HTMLElement | undefined {
    for (const [el, k] of this.buttons) if (k === key) return el;
    return undefined;
  }
}

/** 'tap': tap where the piece should go (see tap.ts). */
export type TouchStyle = 'tap' | 'swipe' | 'buttons';

/** Below this a finger hasn't really moved: a tap, not a drag. */
const TAP_SLOP_PX = 12;
const TAP_MAX_MS = 280;
/** A flick: at least this fast (px per ms) over the last moment of the swipe. */
const FLICK_SPEED = 0.5;
const VELOCITY_WINDOW_MS = 100;
/** A whole swipe this short counts as a flick whatever its speed at the end. */
const FLICK_MAX_MS = 250;

interface Finger {
  id: number;
  startX: number;
  startY: number;
  startAt: number;
  /** Where the last whole cell of sideways movement was counted from. */
  anchorX: number;
  /** Moved sideways at least one cell, so it can't be a tap. */
  moved: boolean;
  softDrop: boolean;
  samples: { y: number; at: number }[];
}

/**
 * Swipe controls over the whole screen: drag sideways and the piece follows
 * the finger a cell at a time, tap to rotate (right half clockwise, left half
 * the other way), drag down to soft drop, flick down to hard drop, flick up
 * to hold. Moves are queued and handed to the game only while a piece is in
 * play, so a drag started just after a drop still counts.
 */
export class SwipeControls {
  readonly root: HTMLElement;
  private finger: Finger | null = null;
  private queue: Key[] = [];
  /** Screen pixels per board cell, times the sensitivity. */
  cellPx = 30;

  constructor(
    parent: HTMLElement,
    private down: (code: string, key: Key) => void,
    private up: (code: string) => void,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'swipe';
    this.root.className = 'swipe hidden';
    parent.append(this.root);
    const opts = { passive: false } as const;
    this.root.addEventListener('pointerdown', (e) => this.start(e), opts);
    this.root.addEventListener('pointermove', (e) => this.move(e), opts);
    this.root.addEventListener('pointerup', (e) => this.end(e));
    this.root.addEventListener('pointercancel', () => this.cancel());
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  setVisible(on: boolean): void {
    if (on === this.visible) return;
    if (!on) this.cancel();
    this.root.classList.toggle('hidden', !on);
  }

  /** Presses the queued taps; call each frame with whether a piece is in play. */
  flush(ready: boolean): void {
    if (!ready) return;
    for (const key of this.queue) {
      this.down(touchCode(key), key);
      this.up(touchCode(key));
    }
    this.queue = [];
  }

  cancel(): void {
    if (this.finger?.softDrop) this.up(touchCode('softDrop'));
    this.finger = null;
    this.queue = [];
  }

  private start(e: PointerEvent): void {
    e.preventDefault();
    // One finger steers; a second one is ignored.
    if (this.finger) return;
    this.root.setPointerCapture?.(e.pointerId);
    this.finger = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startAt: e.timeStamp,
      anchorX: e.clientX,
      moved: false,
      softDrop: false,
      samples: [{ y: e.clientY, at: e.timeStamp }],
    };
  }

  private move(e: PointerEvent): void {
    const f = this.finger;
    if (!f || e.pointerId !== f.id) return;
    e.preventDefault();
    f.samples.push({ y: e.clientY, at: e.timeStamp });
    while (f.samples.length > 2 && e.timeStamp - f.samples[0].at > VELOCITY_WINDOW_MS) f.samples.shift();

    const cell = Math.max(8, this.cellPx);
    const cells = Math.trunc((e.clientX - f.anchorX) / cell);
    if (cells !== 0) {
      const key: Key = cells < 0 ? 'left' : 'right';
      for (let i = 0; i < Math.abs(cells); i++) this.queue.push(key);
      f.anchorX += cells * cell;
      f.moved = true;
    }
    // Dragging down (more down than sideways) holds soft drop; going back up lets go.
    const dy = e.clientY - f.startY;
    const wantSoft = dy > cell * 1.5 && dy > Math.abs(e.clientX - f.startX);
    if (wantSoft !== f.softDrop) {
      f.softDrop = wantSoft;
      if (wantSoft) this.down(touchCode('softDrop'), 'softDrop');
      else this.up(touchCode('softDrop'));
    }
  }

  private end(e: PointerEvent): void {
    const f = this.finger;
    if (!f || e.pointerId !== f.id) return;
    this.finger = null;
    if (f.softDrop) this.up(touchCode('softDrop'));
    const dx = e.clientX - f.startX;
    const dy = e.clientY - f.startY;
    const first = f.samples[0];
    const speed = e.timeStamp > first.at ? (e.clientY - first.y) / (e.timeStamp - first.at) : 0;
    const cell = Math.max(8, this.cellPx);
    const vertical = Math.abs(dy) > Math.abs(dx);
    // Fast at the end, or a short swipe done quickly as a whole.
    const quick = e.timeStamp - f.startAt < FLICK_MAX_MS;
    if (vertical && dy > cell * 2 && (speed > FLICK_SPEED || quick)) return void this.queue.push('hardDrop');
    if (vertical && dy < -cell * 2 && (speed < -FLICK_SPEED || quick)) return void this.queue.push('hold');
    if (!f.moved && Math.hypot(dx, dy) < TAP_SLOP_PX && e.timeStamp - f.startAt < TAP_MAX_MS) {
      this.queue.push(e.clientX >= innerWidth / 2 ? 'rotateCW' : 'rotateCCW');
    }
  }
}
