import { CHARACTERS, EARNED_SKINS, SKINS, THEMES, type CharacterId, type Look, type SkinId, type ThemeId } from './cosmetics';

// ---- the shop ---------------------------------------------------------------
// Looks only, never power. Items cost gems; gems are bought in packs with
// real money, so a small item doesn't pay a whole card fee by itself. Shared
// by the server (which owns the truth) and the browser (which shows it).

export type ItemKind = 'character' | 'skin' | 'theme';
/** e.g. "skin:neon". */
export type ItemId = `${ItemKind}:${string}`;

export interface ShopItem {
  id: ItemId;
  kind: ItemKind;
  /** The character, skin or theme id. */
  key: string;
  /** Gems, or 0 for an item everyone has. */
  price: number;
  /** Set for items that are earned by playing and never sold. */
  earned?: string;
}

/** Gem prices. Anything not listed here is free. */
const PRICES: Partial<Record<ItemId, number>> = {
  'character:bolt': 400,
  'character:pip': 400,
  'skin:pixel': 150,
  'skin:neon': 250,
  'skin:candy': 250,
  'skin:stone': 250,
  'theme:sakura': 150,
  'theme:paper': 150,
};

export const SHOP_ITEMS: ShopItem[] = [
  ...CHARACTERS.map((key) => ({ kind: 'character' as const, key })),
  ...SKINS.map((key) => ({ kind: 'skin' as const, key })),
  ...THEMES.map((key) => ({ kind: 'theme' as const, key })),
].map(({ kind, key }) => {
  const id = `${kind}:${key}` as ItemId;
  const earned = kind === 'skin' ? EARNED_SKINS[key as SkinId] : undefined;
  return { id, kind, key, price: earned ? 0 : (PRICES[id] ?? 0), ...(earned ? { earned } : {}) };
});

const BY_ID = new Map(SHOP_ITEMS.map((i) => [i.id, i]));

export function shopItem(id: unknown): ShopItem | null {
  return typeof id === 'string' ? (BY_ID.get(id as ItemId) ?? null) : null;
}

/** Items you can buy with gems. */
export function forSale(item: ShopItem): boolean {
  return item.price > 0 && !item.earned;
}

/** A pack of gems for real money. Prices are what the player pays, taxes included. */
export interface GemPack {
  id: string;
  gems: number;
  vnd: number;
  usd: number;
}

export const GEM_PACKS: GemPack[] = [
  { id: 'gems-200', gems: 200, vnd: 49_000, usd: 1.99 },
  { id: 'gems-550', gems: 550, vnd: 119_000, usd: 4.99 },
  { id: 'gems-1200', gems: 1200, vnd: 239_000, usd: 9.99 },
];

/** Gems for an online match with an account. Earning stops at the daily cap. */
export const MATCH_GEMS = {
  win: 15,
  /** A finished match you lost; leaving early earns nothing. */
  loss: 5,
  /** On top, for your first win of the day. */
  firstWin: 30,
  /** Most gems from matches in one day (Vietnam time). */
  dailyCap: 150,
} as const;

/** What the shop sends a signed-in player: their gems and what they own. */
export interface Wallet {
  gems: number;
  /** Bought items; free and earned items aren't listed. */
  owned: ItemId[];
}

/**
 * True when this item can be used: it's free, earned (the game checks the
 * earning itself), or in `owned`.
 */
export function canUse(kind: ItemKind, key: string, owned: readonly string[]): boolean {
  const item = BY_ID.get(`${kind}:${key}` as ItemId);
  if (!item) return false;
  return !forSale(item) || owned.includes(item.id);
}

/** A look with anything not owned swapped for the default, so nobody shows off an item they didn't buy. */
export function usableLook(look: Look, owned: readonly string[]): Look {
  return {
    character: canUse('character', look.character, owned) ? look.character : ('bao' satisfies CharacterId),
    skin: canUse('skin', look.skin, owned) ? look.skin : ('gem' satisfies SkinId),
  };
}

export function usableTheme(theme: ThemeId, owned: readonly string[]): ThemeId {
  return canUse('theme', theme, owned) ? theme : 'night';
}

/** GET /api/shop */
export interface ShopInfo {
  items: ShopItem[];
  packs: GemPack[];
  /** Payment providers that are switched on; empty while buying gems isn't open. */
  payments: string[];
}

/** POST /api/shop/checkout: the payment page to send the player to. */
export interface CheckoutResponse {
  url: string;
}
