import type { Store } from './store';

// Rooms are created by Colyseus, not by us, so they find the store here.
let current: Store | null = null;

export function setStore(store: Store | null): void {
  current = store;
}

/** Null when the server runs without a database: online play still works, but nothing is saved. */
export function getStore(): Store | null {
  return current;
}
