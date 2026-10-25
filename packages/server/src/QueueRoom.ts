import { matchMaker, Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import {
  BATTLE_ROOM,
  isRegion,
  sanitizeHandling,
  sanitizeLook,
  type Handling,
  type Look,
  type QueueJoinOptions,
  type QueueKind,
  type QueueMessages,
  type Region,
} from '@line-battle/engine';
import { DEFAULT_RATING } from './glicko';
import { getStore } from './services';
import type { User } from './store';
import { cleanName } from './names';

/** How often the queue looks for pairs. */
export const PAIR_EVERY_MS = 1000;
/** How often a waiting player hears how the search is going. */
export const STATUS_EVERY_MS = 3000;
/** Rating gap allowed straight away, by queue. */
export const BASE_RANGE: Record<QueueKind, number> = { ranked: 100, quick: 200 };
/** The gap widens this much for every second of waiting. */
export const RANGE_PER_SECOND: Record<QueueKind, number> = { ranked: 15, quick: 30 };
/** After both players have waited this long, the queue pairs across regions too. */
export const ANY_REGION_AFTER_MS = 20_000;

export interface QueueRoomOptions {
  /** Tests shorten the timings. */
  pairEveryMs?: number;
  anyRegionAfterMs?: number;
}

interface Entry {
  client: Client;
  kind: QueueKind;
  user: User | null;
  name: string;
  handling: Handling;
  look: Look;
  region: Region;
  rating: number;
  since: number;
}

/**
 * The matchmaking queue: players wait here, and pairs close in rating (and
 * in the same region, until the wait gets long) are sent to a fresh match
 * room with seats already held for them. Ranked needs an account; quick
 * match takes guests too, at the starting rating.
 */
export class QueueRoom extends Room {
  maxClients = 2000;

  private entries: Entry[] = [];
  private anyRegionAfterMs = ANY_REGION_AFTER_MS;
  private pairing = false;

  onCreate(options: QueueRoomOptions = {}): void {
    this.anyRegionAfterMs = options.anyRegionAfterMs ?? ANY_REGION_AFTER_MS;
    this.autoDispose = true;
    this.clock.setInterval(() => void this.pair(), options.pairEveryMs ?? PAIR_EVERY_MS);
    this.clock.setInterval(() => this.entries.forEach((e) => this.sendStatus(e)), STATUS_EVERY_MS);
  }

  onAuth(_client: Client, options: Partial<QueueJoinOptions>, context: AuthContext): { user: User | null } {
    const user = getStore()?.userForToken(context.token) ?? null;
    if (options?.queue === 'ranked' && !user) throw new ServerError(401, 'Log in to play ranked.');
    return { user };
  }

  onJoin(client: Client, options: Partial<QueueJoinOptions> = {}): void {
    const user = (client.auth as { user: User | null } | undefined)?.user ?? null;
    const kind: QueueKind = options.queue === 'ranked' ? 'ranked' : 'quick';
    // One place in the queue per account: a second tab takes over from the first.
    if (user) {
      for (const old of this.entries.filter((e) => e.user?.id === user.id)) {
        this.remove(old.client);
        old.client.leave(4000);
      }
    }
    const region = isRegion(options.region) ? options.region : (user?.region ?? 'asia');
    const entry: Entry = {
      client,
      kind,
      user,
      name: user ? user.name : cleanName(options.name),
      handling: sanitizeHandling(options.handling),
      look: sanitizeLook(options.look),
      region,
      rating: user ? user.rating.rating : DEFAULT_RATING.rating,
      since: Date.now(),
    };
    this.entries.push(entry);
    this.sendStatus(entry);
    void this.pair();
  }

  onLeave(client: Client): void {
    this.remove(client);
  }

  /** Rating gap this player accepts right now. */
  private range(e: Entry, now: number): number {
    return BASE_RANGE[e.kind] + (RANGE_PER_SECOND[e.kind] * (now - e.since)) / 1000;
  }

  private anyRegion(e: Entry, now: number): boolean {
    return now - e.since >= this.anyRegionAfterMs;
  }

  /** Pairs everyone it can, longest wait first, each with the closest fit. */
  private async pair(): Promise<void> {
    if (this.pairing) return;
    this.pairing = true;
    try {
      const now = Date.now();
      const waiting = [...this.entries].sort((a, b) => a.since - b.since);
      const taken = new Set<Entry>();
      const pairs: [Entry, Entry][] = [];
      for (const e of waiting) {
        if (taken.has(e)) continue;
        let best: Entry | null = null;
        let bestCost = Infinity;
        for (const f of waiting) {
          if (f === e || taken.has(f) || f.kind !== e.kind) continue;
          if (e.user && f.user && e.user.id === f.user.id) continue;
          const sameRegion = e.region === f.region;
          if (!sameRegion && !(this.anyRegion(e, now) && this.anyRegion(f, now))) continue;
          const gap = Math.abs(e.rating - f.rating);
          if (gap > Math.max(this.range(e, now), this.range(f, now))) continue;
          // Same region beats a slightly closer rating far away.
          const cost = gap + (sameRegion ? 0 : 300);
          if (cost < bestCost) {
            best = f;
            bestCost = cost;
          }
        }
        if (best) {
          taken.add(e);
          taken.add(best);
          pairs.push([e, best]);
        }
      }
      for (const pair of pairs) for (const e of pair) this.remove(e.client);
      await Promise.all(pairs.map((p) => this.startMatch(p)));
    } finally {
      this.pairing = false;
    }
  }

  private async startMatch(pair: [Entry, Entry]): Promise<void> {
    const [a] = pair;
    try {
      const room = await matchMaker.createRoom(BATTLE_ROOM, { mode: a.kind, region: a.region });
      for (const e of pair) {
        const reservation = await matchMaker.reserveSeatFor(room, { name: e.name, handling: e.handling, look: e.look }, { user: e.user, queued: true });
        this.tell(e, 'matched', { reservation });
      }
    } catch (err) {
      console.error('queue: could not start a match', err);
      // Put them back at the front, so the next pass tries again.
      for (const e of pair) if (this.clients.some((c) => c.sessionId === e.client.sessionId)) this.entries.push(e);
    }
  }

  private remove(client: Client): void {
    this.entries = this.entries.filter((e) => e.client.sessionId !== client.sessionId);
  }

  private sendStatus(e: Entry): void {
    const now = Date.now();
    this.tell(e, 'searching', {
      waitedMs: now - e.since,
      region: e.region,
      rating: Math.round(e.rating),
      range: Math.round(this.range(e, now)),
      anyRegion: this.anyRegion(e, now),
      inQueue: this.entries.filter((x) => x.kind === e.kind).length,
    });
  }

  private tell<K extends keyof QueueMessages>(e: Entry, type: K, msg: QueueMessages[K]): void {
    e.client.send(type, msg);
  }
}
