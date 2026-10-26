import { KEYS, type Key } from './game';

// ---- cosmetics and preferences ---------------------------------------------
// Looks only: nothing here changes pieces, damage or speed. Shared by the
// browser (which draws them) and the server (which stores them on accounts
// and tells each player what the opponent looks like).

export const CHARACTERS = ['bao', 'mochi', 'bolt', 'pip'] as const;
export type CharacterId = (typeof CHARACTERS)[number];

export const CHARACTER_NAMES: Record<CharacterId, string> = {
  bao: 'Bao the kid',
  mochi: 'Mochi the cat',
  bolt: 'Bolt the robot',
  pip: 'Pip the frog',
};

/** Block skins. The ghost piece and garbage rows look the same in all of them. */
export const SKINS = ['gem', 'flat', 'glossy', 'pixel', 'neon', 'candy', 'stone', 'gold'] as const;
export type SkinId = (typeof SKINS)[number];

export const SKIN_NAMES: Record<SkinId, string> = {
  gem: 'Gem',
  flat: 'Flat',
  glossy: 'Glossy',
  pixel: 'Pixel',
  neon: 'Neon',
  candy: 'Candy',
  stone: 'Stone',
  gold: 'Gold',
};

/** Skins that are earned by playing, never sold. */
export const EARNED_SKINS: Partial<Record<SkinId, string>> = {
  gold: 'Beat all 5 bots in the gauntlet',
};

export const THEMES = ['night', 'ocean', 'sakura', 'paper'] as const;
export type ThemeId = (typeof THEMES)[number];

export const THEME_NAMES: Record<ThemeId, string> = {
  night: 'Night',
  ocean: 'Ocean',
  sakura: 'Sakura',
  paper: 'Paper',
};

/** What other players see of you: sent with your name when you join a match. */
export interface Look {
  character: CharacterId;
  skin: SkinId;
}

export const DEFAULT_LOOK: Look = { character: 'bao', skin: 'gem' };

/** Keyboard keys (KeyboardEvent.code) for each action; up to 3 per action. */
export type KeyMap = Record<Key, string[]>;

export const DEFAULT_KEYS: KeyMap = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  softDrop: ['ArrowDown'],
  hardDrop: ['Space'],
  rotateCW: ['ArrowUp', 'KeyX'],
  rotateCCW: ['KeyZ', 'ControlLeft', 'ControlRight'],
  rotate180: ['KeyA'],
  hold: ['KeyC', 'ShiftLeft', 'ShiftRight'],
};

export const MAX_KEYS_PER_ACTION = 3;

/** Everything a player can set besides handling and region; kept on the account. */
export interface Prefs {
  look: Look;
  theme: ThemeId;
  keys: KeyMap;
  /** Sound effects volume, 0-100. */
  volume: number;
  /** Background music volume, 0-100. */
  music: number;
  /** Draw the opponent's board in the default skin. */
  plainOpponent: boolean;
  /** The tutorial was finished or skipped. */
  tutorialDone: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  look: DEFAULT_LOOK,
  theme: 'night',
  keys: DEFAULT_KEYS,
  volume: 70,
  music: 50,
  plainOpponent: false,
  tutorialDone: false,
};

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;

export function sanitizeLook(v: unknown): Look {
  const src = (v ?? {}) as Record<string, unknown>;
  return {
    character: oneOf(CHARACTERS, src.character, DEFAULT_LOOK.character),
    skin: oneOf(SKINS, src.skin, DEFAULT_LOOK.skin),
  };
}

const KEY_CODE = /^[A-Za-z0-9]{1,24}$/;

/**
 * A key map with only known actions and plausible key codes. A key bound to
 * two actions stays with the first one, and an action left with no key gets
 * its default back, so a broken map can never leave the game unplayable.
 */
export function sanitizeKeys(v: unknown): KeyMap {
  const src = (v ?? {}) as Record<string, unknown>;
  const used = new Set<string>();
  const out = {} as KeyMap;
  for (const key of KEYS) {
    const list = Array.isArray(src[key]) ? (src[key] as unknown[]) : [];
    const codes = list.filter((c): c is string => typeof c === 'string' && KEY_CODE.test(c) && !used.has(c)).slice(0, MAX_KEYS_PER_ACTION);
    codes.forEach((c) => used.add(c));
    out[key] = codes;
  }
  for (const key of KEYS) {
    if (out[key].length > 0) continue;
    const free = DEFAULT_KEYS[key].filter((c) => !used.has(c));
    free.forEach((c) => used.add(c));
    out[key] = free;
  }
  return out;
}

export function sanitizePrefs(v: unknown): Prefs {
  const src = (v ?? {}) as Record<string, unknown>;
  const percent = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : fallback);
  return {
    look: sanitizeLook(src.look),
    theme: oneOf(THEMES, src.theme, DEFAULT_PREFS.theme),
    keys: sanitizeKeys(src.keys),
    volume: percent(src.volume, DEFAULT_PREFS.volume),
    music: percent(src.music, DEFAULT_PREFS.music),
    plainOpponent: src.plainOpponent === true,
    tutorialDone: src.tutorialDone === true,
  };
}
