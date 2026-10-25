import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import {
  BATTLE_ROOM,
  DEFAULT_HANDLING,
  OnlinePlayer,
  TICK_RATE,
  type JoinOptions,
  type KeyEvent,
  type ServerMessages,
} from '@line-battle/engine';
import { BattleRoom } from '../src';

let server: Server;
let url = '';

beforeAll(async () => {
  const http = createServer();
  server = new Server({ transport: new WebSocketTransport({ server: http }), greet: false, gracefullyShutdown: false });
  server.define(BATTLE_ROOM, BattleRoom, { countdownMs: 50, roundBreakMs: 50 }).filterBy(['mode']);
  await server.listen(0);
  url = `ws://localhost:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

const hardDrops = (t: number): KeyEvent[] => (t % 4 === 0 ? [{ key: 'hardDrop', down: true }, { key: 'hardDrop', down: false }] : []);

type Got = { [K in keyof ServerMessages]?: ServerMessages[K][] };

/** A test player: records every message and, once a round starts, plays in real time. */
class Player {
  got: Got = {};
  local: OnlinePlayer | null = null;
  connected = true;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly room: Room,
    /** Inputs for each tick; the default hard drops every few ticks to top out fast. */
    public policy: (tick: number) => KeyEvent[] = hardDrops,
  ) {
    room.reconnection.minUptime = 0;
    room.onDrop(() => (this.connected = false));
    room.onReconnect(() => (this.connected = true));
    for (const type of ['waiting', 'match', 'round', 'garbage', 'opp', 'resync', 'oppStatus', 'roundEnd', 'matchEnd', 'rematch'] as const) {
      room.onMessage(type, (msg: never) => {
        (this.got[type] ??= [] as never[]).push(msg);
        if (type === 'round') this.startRound(msg as ServerMessages['round']);
        if (type === 'garbage') this.local?.receive(msg as ServerMessages['garbage']);
        if (type === 'resync') this.resync(msg as ServerMessages['resync']);
        if (type === 'roundEnd' || type === 'matchEnd') this.stop();
      });
    }
  }

  private startRound(r: ServerMessages['round']): void {
    this.stop();
    const local = new OnlinePlayer(r.seed, DEFAULT_HANDLING);
    this.local = local;
    const start = Date.now() + r.countdownMs;
    this.timer = setInterval(() => {
      const target = Math.floor(((Date.now() - start) * TICK_RATE) / 1000);
      while (local.game.tick < target && !local.game.over) local.step(this.policy(local.game.tick));
      if (target >= 0 && this.connected) this.room.send('inputs', local.takeBatch());
    }, 50);
  }

  private resync(r: ServerMessages['resync']): void {
    const you = this.got.match!.at(-1)!.you;
    this.local!.resendFrom(r.logs[you].upTo);
    for (const g of r.pending) this.local!.receive(g);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async waitFor<K extends keyof ServerMessages>(type: K, count = 1, ms = 15_000): Promise<ServerMessages[K][]> {
    const until = Date.now() + ms;
    while ((this.got[type]?.length ?? 0) < count) {
      if (Date.now() > until) throw new Error(`timed out waiting for ${type}`);
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.got[type] as ServerMessages[K][];
  }
}

const opts = (mode: JoinOptions['mode'], name: string): JoinOptions => ({ mode, name, handling: DEFAULT_HANDLING });

describe('battle room', () => {
  it('runs a private room match to the end, first to 2', async () => {
    const hostRoom = await new Client(url).create(BATTLE_ROOM, opts('private', 'Host'));
    const host = new Player(hostRoom);
    const [{ code }] = await host.waitFor('waiting');
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    expect(hostRoom.roomId).toBe(code);

    // The host hard drops nonstop and the guest waits, so the host tops out in both rounds.
    const guest = new Player(await new Client(url).joinById(code!, opts('private', 'Guest <b>')), () => []);
    const [match] = await guest.waitFor('match');
    expect(match.you).toBe(1);
    expect(match.names).toEqual(['Host', 'Guest b']);

    const [end] = await host.waitFor('matchEnd');
    expect(end).toEqual({ winner: 1, score: [0, 2], reason: 'topOut' });
    expect(host.got.roundEnd).toEqual([{ winner: 1, score: [0, 1], reason: 'topOut' }]);
    // The guest saw the host's board through relayed inputs.
    expect(guest.got.opp!.length).toBeGreaterThan(3);
    await Promise.all([hostRoom.leave(), guest.room.leave()]);
  }, 30_000);

  it('quick match pairs two players and keeps private rooms out', async () => {
    const priv = new Player(await new Client(url).create(BATTLE_ROOM, opts('private', 'Lonely'))).room;
    const a = new Player(await new Client(url).joinOrCreate(BATTLE_ROOM, opts('quick', 'A')), () => []);
    const b = new Player(await new Client(url).joinOrCreate(BATTLE_ROOM, opts('quick', 'B')), () => []);
    expect(a.room.roomId).toBe(b.room.roomId);
    expect(a.room.roomId).not.toBe(priv.roomId);
    await b.waitFor('round');
    // A leaving mid-match hands B the win.
    await a.room.leave();
    const [end] = await b.waitFor('matchEnd');
    expect(end.winner).toBe(1);
    expect(end.reason).toBe('left');
    await Promise.all([b.room.leave(), priv.leave()]);
  }, 30_000);

  it('rejects impossible inputs and ends the match', async () => {
    const hostRoom = await new Client(url).create(BATTLE_ROOM, opts('private', 'Cheat'));
    const host = new Player(hostRoom, () => []);
    const [{ code }] = await host.waitFor('waiting');
    const guest = new Player(await new Client(url).joinById(code!, opts('private', 'Fair')), () => []);
    await host.waitFor('round');
    host.stop();
    // Claiming ten seconds of play right away is a speed hack.
    hostRoom.send('inputs', { upTo: 600, keys: [], acks: [] });
    const [end] = await guest.waitFor('matchEnd');
    expect(end).toMatchObject({ winner: 1, reason: 'invalid' });
    await Promise.all([hostRoom.leave(), guest.room.leave()]);
  }, 30_000);

  it('a rematch starts a new match when both ask', async () => {
    const hostRoom = await new Client(url).create(BATTLE_ROOM, opts('private', 'H'));
    const host = new Player(hostRoom);
    const [{ code }] = await host.waitFor('waiting');
    const guest = new Player(await new Client(url).joinById(code!, opts('private', 'G')), () => []);
    await host.waitFor('matchEnd');
    hostRoom.send('rematch');
    await guest.waitFor('rematch');
    expect(guest.got.rematch![0]).toEqual({ requested: [true, false] });
    guest.room.send('rematch');
    await host.waitFor('round', 3);
    expect(host.got.match!.at(-1)!.score).toEqual([0, 0]);
    await Promise.all([hostRoom.leave(), guest.room.leave()]);
  }, 30_000);

  it('a dropped player reconnects and carries on', async () => {
    const hostRoom = await new Client(url).create(BATTLE_ROOM, opts('private', 'Flaky'));
    const host = new Player(hostRoom, () => []);
    const [{ code }] = await host.waitFor('waiting');
    const guest = new Player(await new Client(url).joinById(code!, opts('private', 'Steady')), () => []);
    await host.waitFor('round');
    await new Promise((r) => setTimeout(r, 400));
    // Kill the host's socket from the server side, like a network drop.
    const room = matchMaker.getLocalRoomById(code!);
    (room.clients.find((c) => c.sessionId === hostRoom.sessionId)!.ref as unknown as { terminate(): void }).terminate();
    await guest.waitFor('oppStatus', 2);
    expect(guest.got.oppStatus).toEqual([{ connected: false }, { connected: true }]);
    const [resync] = await host.waitFor('resync');
    expect(resync.round).toBe(1);
    // Play resumes: the host's ticks keep being accepted, then the host tops out twice.
    host.policy = hardDrops;
    const [end] = await guest.waitFor('matchEnd');
    expect(end).toEqual({ winner: 1, score: [0, 2], reason: 'topOut' });
    await Promise.all([hostRoom.leave(), guest.room.leave()]);
  }, 30_000);
});
