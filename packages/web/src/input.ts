import { KEYS, type Key, type KeyEvent, type KeyMap } from '@line-battle/engine';

export type Bindings = Record<string, Key>;

/** Single-player bindings by KeyboardEvent.code, from the player's key map. */
export function bindingsFrom(keys: KeyMap): Bindings {
  const out: Bindings = {};
  for (const key of KEYS) for (const code of keys[key]) out[code] = key;
  return out;
}

export const ACTION_NAMES: Record<Key, string> = {
  left: 'Move left',
  right: 'Move right',
  softDrop: 'Soft drop',
  hardDrop: 'Hard drop',
  rotateCW: 'Rotate clockwise',
  rotateCCW: 'Rotate counter-clockwise',
  rotate180: 'Rotate 180',
  hold: 'Hold',
};

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Space: 'Space',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

/** A key code as players know it: "KeyX" is "X", "ArrowUp" is "↑". */
export function keyLabel(code: string): string {
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

/** "← or X" style text for an action's keys. */
export function keysText(codes: readonly string[]): string {
  return codes.length ? codes.map(keyLabel).join(' or ') : 'none';
}

/** Keys the game needs for itself and so can't be bound. */
export const RESERVED_CODES = new Set(['Escape', 'Enter', 'Tab', 'KeyR', 'MetaLeft', 'MetaRight', 'F5', 'F11', 'F12']);

/** Local versus, left player. No Ctrl, so a Ctrl+W can't close the tab mid-round. */
export const P1_BINDINGS: Bindings = {
  KeyA: 'left',
  KeyD: 'right',
  KeyS: 'softDrop',
  KeyW: 'hardDrop',
  KeyE: 'rotateCW',
  KeyQ: 'rotateCCW',
  KeyZ: 'rotate180',
  ShiftLeft: 'hold',
};

/** Local versus, right player. */
export const P2_BINDINGS: Bindings = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'softDrop',
  ArrowUp: 'hardDrop',
  Period: 'rotateCW',
  Comma: 'rotateCCW',
  Slash: 'rotate180',
  ShiftRight: 'hold',
};

/**
 * Turns keyboard events into engine key events. An action counts as held
 * while any key bound to it is down, so two keys for one action don't clash.
 */
export class Keyboard {
  private codesDown = new Set<string>();
  private pending: KeyEvent[] = [];

  constructor(private bindings: Bindings) {}

  /** New key bindings; anything held is released first. */
  setBindings(bindings: Bindings): void {
    this.releaseAll();
    this.pending = [];
    this.bindings = bindings;
  }

  /** The action a key code is bound to, if any. */
  actionFor(code: string): Key | undefined {
    return this.bindings[code];
  }

  /** Returns true if the code is a game key (the caller should preventDefault). */
  keyDown(code: string): boolean {
    const key = this.bindings[code];
    if (!key) return false;
    if (this.codesDown.has(code)) return true;
    const wasHeld = this.isHeld(key);
    this.codesDown.add(code);
    if (!wasHeld) this.pending.push({ key, down: true });
    return true;
  }

  keyUp(code: string): boolean {
    const key = this.bindings[code];
    if (!key || !this.codesDown.delete(code)) return !!key;
    if (!this.isHeld(key)) this.pending.push({ key, down: false });
    return true;
  }

  /** Releases everything, e.g. when the window loses focus. */
  releaseAll(): void {
    for (const code of [...this.codesDown]) this.keyUp(code);
  }

  /** Events since the last call, for the next game tick. */
  take(): KeyEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** Down events for every held action, used to carry held keys into a new game. */
  heldEvents(): KeyEvent[] {
    const keys = new Set([...this.codesDown].map((c) => this.bindings[c]));
    return [...keys].map((key) => ({ key, down: true }));
  }

  clearPending(): void {
    this.pending = [];
  }

  private isHeld(key: Key): boolean {
    for (const code of this.codesDown) if (this.bindings[code] === key) return true;
    return false;
  }
}
