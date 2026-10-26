/**
 * Caps how many players can be in online matches at once, so the one match
 * server process never gets more boards to referee than it can keep up with
 * (load tests put its limit near 1,000). Players over the cap wait in the
 * queue until a slot frees up. MAX_PLAYERS overrides the default.
 */
export const DEFAULT_MAX_PLAYERS = 500;

let maxPlayers = Number(process.env.MAX_PLAYERS) || DEFAULT_MAX_PLAYERS;
let used = 0;

/** Tests change the cap. */
export function setMaxPlayers(n: number): void {
  maxPlayers = n;
}

export function freeSlots(): number {
  return Math.max(0, maxPlayers - used);
}

export function playersInMatches(): number {
  return used;
}

/** Takes `n` slots if they are all free; false (and nothing taken) otherwise. */
export function takeSlots(n: number): boolean {
  if (freeSlots() < n) return false;
  used += n;
  return true;
}

export function releaseSlots(n: number): void {
  used = Math.max(0, used - n);
}
