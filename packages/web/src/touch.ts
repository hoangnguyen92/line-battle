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

/** What a touch button shows, by its made-up key code, e.g. for the tutorial's text. */
export function touchLabel(code: string): string | undefined {
  return [...LEFT, ...RIGHT].find((s) => touchCode(s.key) === code)?.icon;
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
