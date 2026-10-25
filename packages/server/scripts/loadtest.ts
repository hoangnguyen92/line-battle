/**
 * Load test: many guest players join quick match at once, play at about a
 * human pace, and queue again when their match ends. Point it at a test
 * server, never the live one: every match it plays is saved.
 *
 *   npx tsx scripts/loadtest.ts --url ws://localhost:2568 --players 400 --seconds 120
 *
 * It reports matches played, input rejections, and how fast /health answers
 * while the server is busy. Watch the server's CPU and memory alongside it.
 */
import { Client, type Room } from '@colyseus/sdk';
import {
  DEFAULT_HANDLING,
  DEFAULT_LOOK,
  OnlinePlayer,
  QUEUE_ROOM,
  TICK_RATE,
  type KeyEvent,
  type QueueJoinOptions,
  type QueueMessages,
  type ServerMessages,
} from '@line-battle/engine';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const url = arg('url', 'ws://localhost:2568');
const players = Number(arg('players', '200'));
const seconds = Number(arg('seconds', '60'));
/** Ticks between pieces: 40 ticks is 1.5 pieces per second, a casual player. */
const pieceEvery = Number(arg('piece-every', '40'));
const httpUrl = url.replace(/^ws/, 'http');

const stats = {
  matchesStarted: 0,
  matchesEnded: 0,
  rounds: 0,
  invalid: 0,
  errors: 0,
  batchesSent: 0,
  healthMs: [] as number[],
};

const KEYS: KeyEvent['key'][] = ['left', 'right', 'rotateCW', 'rotateCCW'];

/** A few random moves, then a hard drop, every `pieceEvery` ticks. */
function policy(tick: number): KeyEvent[] {
  const phase = tick % pieceEvery;
  if (phase === pieceEvery - 1) return [{ key: 'hardDrop', down: true }, { key: 'hardDrop', down: false }];
  if (phase % 8 === 4) {
    const key = KEYS[Math.floor(Math.random() * KEYS.length)];
    return [{ key, down: true }, { key, down: false }];
  }
  return [];
}

const stopAt = Date.now() + seconds * 1000;

/** One player: queue, play the match, queue again, until time is up. */
async function bot(n: number): Promise<void> {
  // Spread the joins over a few seconds, like real arrivals.
  await new Promise((r) => setTimeout(r, Math.random() * 5000));
  while (Date.now() < stopAt) {
    try {
      await playOne(n);
    } catch {
      stats.errors++;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function playOne(n: number): Promise<void> {
  const client = new Client(url);
  const opts: QueueJoinOptions = { queue: 'quick', region: 'asia', name: `load${n}`, handling: DEFAULT_HANDLING, look: DEFAULT_LOOK };
  const queue = await client.joinOrCreate(QUEUE_ROOM, opts);
  const room = await new Promise<Room>((resolve, reject) => {
    queue.onMessage('matched', async ({ reservation }: QueueMessages['matched']) => {
      try {
        resolve(await client.consumeSeatReservation(reservation as never));
      } catch (e) {
        reject(e);
      }
    });
    queue.onMessage('searching', () => {});
  });
  void queue.leave();
  stats.matchesStarted++;
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  let local: OnlinePlayer | null = null;
  await new Promise<void>((resolve) => {
    room.onMessage('garbage', (g: ServerMessages['garbage']) => local?.receive(g));
    room.onMessage('round', (r: ServerMessages['round']) => {
      stop();
      stats.rounds++;
      const player = new OnlinePlayer(r.seed, DEFAULT_HANDLING);
      local = player;
      const start = Date.now() + r.countdownMs;
      timer = setInterval(() => {
        const target = Math.floor(((Date.now() - start) * TICK_RATE) / 1000);
        while (player.game.tick < target && !player.game.over) player.step(policy(player.game.tick));
        if (target >= 0) {
          room.send('inputs', player.takeBatch());
          stats.batchesSent++;
        }
      }, 50);
    });
    room.onMessage('roundEnd', () => stop());
    room.onMessage('matchEnd', (m: ServerMessages['matchEnd']) => {
      stop();
      stats.matchesEnded++;
      if (m.reason === 'invalid') stats.invalid++;
      resolve();
    });
    for (const t of ['match', 'opp', 'oppStatus', 'resync', 'rematch', 'rating', 'saved', 'waiting'] as const) room.onMessage(t, () => {});
    room.onLeave(() => {
      stop();
      resolve();
    });
  });
  stop();
  await room.leave().catch(() => {});
}

async function sampleHealth(): Promise<void> {
  while (Date.now() < stopAt) {
    const t0 = performance.now();
    try {
      await fetch(`${httpUrl}/health`);
      stats.healthMs.push(performance.now() - t0);
    } catch {
      stats.errors++;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1) : '-';
};

console.log(`${players} players on ${url} for ${seconds}s, a piece every ${pieceEvery} ticks`);
const progress = setInterval(() => {
  console.log(`t=${Math.round((seconds * 1000 - (stopAt - Date.now())) / 1000)}s matches ${stats.matchesStarted} started / ${stats.matchesEnded} ended, rounds ${stats.rounds}, invalid ${stats.invalid}, errors ${stats.errors}, health p50 ${pct(stats.healthMs.slice(-10), 0.5)} ms`);
}, 10_000);
await Promise.all([...Array.from({ length: players }, (_, i) => bot(i)), sampleHealth()]);
clearInterval(progress);
console.log(JSON.stringify({
  players,
  seconds,
  ...stats,
  healthMs: undefined,
  healthP50: pct(stats.healthMs, 0.5),
  healthP95: pct(stats.healthMs, 0.95),
  healthMax: pct(stats.healthMs, 1),
}, null, 2));
process.exit(0);
