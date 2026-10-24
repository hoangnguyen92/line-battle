import type { Key, KeyEvent } from '@line-battle/engine';

export type Bindings = Record<string, Key>;

/** Single-player bindings by KeyboardEvent.code. Several keys may share an action. */
export const SOLO_BINDINGS: Bindings = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'softDrop',
  Space: 'hardDrop',
  ArrowUp: 'rotateCW',
  KeyX: 'rotateCW',
  KeyZ: 'rotateCCW',
  ControlLeft: 'rotateCCW',
  ControlRight: 'rotateCCW',
  KeyA: 'rotate180',
  KeyC: 'hold',
  ShiftLeft: 'hold',
  ShiftRight: 'hold',
};

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
