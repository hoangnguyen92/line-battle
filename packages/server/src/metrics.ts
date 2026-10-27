import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';
import { readFileSync, statfsSync, statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { playersInMatches } from './capacity';

const DAY_MS = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
/** Server samples older than this are dropped. */
const SYSTEM_KEEP_MS = 14 * DAY_MS;
/** Raw play events older than this are dropped; the dashboard looks back 30 days. */
const EVENTS_KEEP_MS = 120 * DAY_MS;
/** A visitor whose page sent anything this recently counts as online now. */
const ONLINE_MS = 75 * 1000;

export const EVENT_NAMES = ['visit', 'click', 'play', 'game-finished', 'game-quit', 'game-left', 'time', 'signup'] as const;

const VISITOR = /^[a-z0-9]{16}$/;
const DETAIL = /^[a-z0-9._:-]{1,48}$/i;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY,
  first_at INTEGER NOT NULL,
  source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  visitor TEXT NOT NULL,
  name TEXT NOT NULL,
  detail TEXT,
  value REAL
);
CREATE INDEX IF NOT EXISTS events_at ON events(at);
CREATE TABLE IF NOT EXISTS system_samples (
  at INTEGER PRIMARY KEY,
  cpu REAL NOT NULL,
  mem_used INTEGER NOT NULL,
  mem_total INTEGER NOT NULL,
  disk_used INTEGER NOT NULL,
  disk_total INTEGER NOT NULL,
  load1 REAL NOT NULL,
  lag_ms REAL NOT NULL,
  rss INTEGER NOT NULL,
  net_rx INTEGER NOT NULL,
  net_tx INTEGER NOT NULL,
  playing INTEGER NOT NULL
);
`;

export interface IncomingEvent {
  e: string;
  d?: string;
  n?: number;
}

export interface SystemNow {
  cpu: number;
  memUsed: number;
  memTotal: number;
  diskUsed: number;
  diskTotal: number;
  load: [number, number, number];
  cores: number;
  lagMs: number;
  rss: number;
  /** Bytes per second over the last sample. */
  netRx: number;
  netTx: number;
  playing: number;
  uptimeHost: number;
  uptimeServer: number;
  dbBytes: number;
}

/** The VN calendar day (YYYY-MM-DD) of a time. */
export function vnDay(t: number): string {
  return new Date(t + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Total bytes in and out on the machine's network cards (not loopback). */
function netTotals(): { rx: number; tx: number } {
  try {
    let rx = 0;
    let tx = 0;
    for (const line of readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
      const [name, rest] = line.split(':');
      if (!rest || name.trim() === 'lo') continue;
      const f = rest.trim().split(/\s+/).map(Number);
      rx += f[0];
      tx += f[8];
    }
    return { rx, tx };
  } catch {
    return { rx: 0, tx: 0 };
  }
}

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/**
 * The game's own statistics: anonymous play events from the page and
 * samples of the machine's health.
 * It shares the game's SQLite file.
 */
/** What a reading of the machine is measured against: the previous reading's counters. */
interface Probe {
  cpu: { idle: number; total: number };
  net: { rx: number; tx: number; at: number };
  lag: IntervalHistogram;
  last: SystemNow | null;
}

function newProbe(): Probe {
  return { cpu: cpuTimes(), net: { ...netTotals(), at: Date.now() }, lag: monitorEventLoopDelay({ resolution: 20 }), last: null };
}

export class Metrics {
  /** The per-minute samples that are saved, and the live readings the dashboard polls. */
  private stored = newProbe();
  private live = newProbe();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private db: DatabaseSync,
    private dbPath: string,
    private now: () => number = Date.now,
  ) {
    this.db.exec(SCHEMA);
  }

  /** Samples the machine every minute (and trims old data once an hour). */
  start(): void {
    this.stored.lag.enable();
    this.live.lag.enable();
    let n = 0;
    this.sample();
    this.timer = setInterval(() => {
      this.sample();
      if (n++ % 60 === 0) this.trim();
    }, 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.stored.lag.disable();
    this.live.lag.disable();
  }

  // ---- events from the page ------------------------------------------------

  /** Saves a batch from one visitor. Returns how many events were kept. */
  record(visitor: unknown, events: unknown): number {
    if (typeof visitor !== 'string' || !VISITOR.test(visitor) || !Array.isArray(events)) return 0;
    const now = this.now();
    const insert = this.db.prepare('INSERT INTO events (at, visitor, name, detail, value) VALUES (?, ?, ?, ?, ?)');
    let kept = 0;
    this.db.exec('BEGIN');
    try {
      for (const raw of events.slice(0, 50) as IncomingEvent[]) {
        if (!raw || !(EVENT_NAMES as readonly string[]).includes(raw.e)) continue;
        const detail = typeof raw.d === 'string' && DETAIL.test(raw.d) ? raw.d.toLowerCase() : null;
        const value = typeof raw.n === 'number' && Number.isFinite(raw.n) ? Math.min(Math.max(raw.n, 0), 24 * 3600) : null;
        if (raw.e === 'visit') {
          this.db.prepare('INSERT OR IGNORE INTO visitors (id, first_at, source) VALUES (?, ?, ?)').run(visitor, now, detail ?? 'direct');
        }
        insert.run(now, visitor, raw.e, detail, value);
        kept++;
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return kept;
  }

  // ---- the machine -------------------------------------------------------------

  /** Takes a per-minute sample and saves it. */
  sample(): SystemNow {
    const s = this.measure(this.stored);
    this.db
      .prepare(
        'INSERT OR REPLACE INTO system_samples (at, cpu, mem_used, mem_total, disk_used, disk_total, load1, lag_ms, rss, net_rx, net_tx, playing) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(this.now(), s.cpu, s.memUsed, s.memTotal, s.diskUsed, s.diskTotal, s.load[0], s.lagMs, s.rss, s.netRx, s.netTx, s.playing);
    return s;
  }

  /** The machine right now, for the dashboard's live view; at most one reading a second. */
  liveNow(): { at: number; onlineNow: number; system: SystemNow } {
    const now = this.now();
    const fresh = this.live.last && now - this.live.net.at < 1000 ? this.live.last : this.measure(this.live);
    return { at: now, onlineNow: this.onlineNow(), system: fresh };
  }

  private onlineNow(): number {
    return (this.db.prepare('SELECT count(DISTINCT visitor) n FROM events WHERE at >= ?').get(this.now() - ONLINE_MS) as { n: number }).n;
  }

  private measure(probe: Probe): SystemNow {
    const now = this.now();
    const cpu = cpuTimes();
    const dTotal = cpu.total - probe.cpu.total;
    const busy = dTotal > 0 ? 1 - (cpu.idle - probe.cpu.idle) / dTotal : 0;
    probe.cpu = cpu;
    const net = netTotals();
    const secs = Math.max(0.5, (now - probe.net.at) / 1000);
    const netRx = Math.max(0, (net.rx - probe.net.rx) / secs);
    const netTx = Math.max(0, (net.tx - probe.net.tx) / secs);
    probe.net = { ...net, at: now };
    let diskUsed = 0;
    let diskTotal = 0;
    try {
      const fs = statfsSync(this.dbPath === ':memory:' ? '/' : this.dbPath);
      diskTotal = fs.blocks * fs.bsize;
      diskUsed = (fs.blocks - fs.bfree) * fs.bsize;
    } catch {
      /* no disk numbers */
    }
    let dbBytes = 0;
    try {
      dbBytes = this.dbPath === ':memory:' ? 0 : statSync(this.dbPath).size + (statSync(`${this.dbPath}-wal`, { throwIfNoEntry: false })?.size ?? 0);
    } catch {
      /* not created yet */
    }
    const lagMs = probe.lag.count > 0 ? probe.lag.percentile(99) / 1e6 : 0;
    probe.lag.reset();
    const s: SystemNow = {
      cpu: Math.round(busy * 1000) / 10,
      memUsed: totalmem() - freemem(),
      memTotal: totalmem(),
      diskUsed,
      diskTotal,
      load: loadavg().map((l) => Math.round(l * 100) / 100) as [number, number, number],
      cores: cpus().length,
      lagMs: Math.round(lagMs * 10) / 10,
      rss: process.memoryUsage().rss,
      netRx: Math.round(netRx),
      netTx: Math.round(netTx),
      playing: playersInMatches(),
      uptimeHost: Math.round(uptime()),
      uptimeServer: Math.round(process.uptime()),
      dbBytes,
    };
    probe.last = s;
    return s;
  }

  private trim(): void {
    const now = this.now();
    this.db.prepare('DELETE FROM system_samples WHERE at < ?').run(now - SYSTEM_KEEP_MS);
    this.db.prepare('DELETE FROM events WHERE at < ?').run(now - EVENTS_KEEP_MS);
  }

  // ---- the dashboard ---------------------------------------------------------------

  dashboard(): unknown {
    const now = this.now();
    const all = <T>(sql: string, ...args: (string | number)[]) => this.db.prepare(sql).all(...args) as T[];
    const get = <T>(sql: string, ...args: (string | number)[]) => this.db.prepare(sql).get(...args) as T;
    const dayOf = (col: string) => `date((${col} + ${VN_OFFSET_MS}) / 1000, 'unixepoch')`;
    const dayExpr = dayOf('at');
    const since30 = now - 30 * DAY_MS;
    const since7 = now - 7 * DAY_MS;

    // One row per VN day for the last 30 days.
    const days: Record<string, Record<string, number>> = {};
    for (let i = 29; i >= 0; i--) days[vnDay(now - i * DAY_MS)] = {};
    const put = (rows: { day: string; n: number }[], key: string) => {
      for (const r of rows) if (days[r.day]) days[r.day][key] = r.n;
    };
    put(all(`SELECT ${dayExpr} day, count(DISTINCT visitor) n FROM events WHERE at >= ? GROUP BY day`, since30), 'visitors');
    put(all(`SELECT ${dayOf('first_at')} day, count(*) n FROM visitors WHERE first_at >= ? GROUP BY day`, since30), 'newVisitors');
    put(all(`SELECT ${dayExpr} day, count(DISTINCT visitor) n FROM events WHERE at >= ? AND name = 'play' GROUP BY day`, since30), 'players');
    put(all(`SELECT ${dayExpr} day, count(*) n FROM events WHERE at >= ? AND name = 'play' GROUP BY day`, since30), 'games');
    put(all(`SELECT ${dayExpr} day, round(sum(value) / 60) n FROM events WHERE at >= ? AND name = 'time' GROUP BY day`, since30), 'minutes');
    put(all(`SELECT ${dayOf('created_at')} day, count(*) n FROM users WHERE created_at >= ? GROUP BY day`, since30), 'signups');
    put(all(`SELECT ${dayOf('ended_at')} day, count(*) n FROM matches WHERE ended_at >= ? GROUP BY day`, since30), 'onlineMatches');
    // Came back: seen on a day after the day they first came.
    put(
      all(
        `SELECT ${dayOf('e.at')} day, count(DISTINCT e.visitor) n FROM events e JOIN visitors v ON v.id = e.visitor
         WHERE e.at >= ? AND ${dayOf('e.at')} > ${dayOf('v.first_at')} GROUP BY day`,
        since30,
      ),
      'returning',
    );

    const sources = all<{ source: string; visitors: number; players: number; minutes: number }>(
      `SELECT v.source, count(DISTINCT v.id) visitors,
         count(DISTINCT CASE WHEN e.name = 'play' THEN v.id END) players,
         round(coalesce(sum(CASE WHEN e.name = 'time' THEN e.value END), 0) / 60) minutes
       FROM visitors v LEFT JOIN events e ON e.visitor = v.id
       WHERE v.first_at >= ? GROUP BY v.source ORDER BY visitors DESC LIMIT 30`,
      since30,
    );
    const modes = all<{ mode: string; games: number; finished: number; quit: number; avgSeconds: number }>(
      `SELECT detail mode,
         sum(name = 'play') games,
         sum(name = 'game-finished') finished,
         sum(name IN ('game-quit', 'game-left')) quit,
         round(avg(CASE WHEN name LIKE 'game-%' THEN value END)) avgSeconds
       FROM events WHERE at >= ? AND name IN ('play', 'game-finished', 'game-quit', 'game-left') GROUP BY detail ORDER BY games DESC`,
      since7,
    );
    const clicks = all<{ button: string; clicks: number; visitors: number }>(
      `SELECT detail button, count(*) clicks, count(DISTINCT visitor) visitors FROM events WHERE at >= ? AND name = 'click' GROUP BY detail ORDER BY clicks DESC LIMIT 40`,
      since7,
    );
    // Time on the page per visitor per day, then the typical visit.
    const stay = get<{ avg: number | null; median: number | null }>(
      `WITH t AS (SELECT visitor, ${dayExpr} day, sum(value) s FROM events WHERE at >= ? AND name = 'time' GROUP BY visitor, day)
       SELECT round(avg(s)) avg, (SELECT s FROM t ORDER BY s LIMIT 1 OFFSET (SELECT count(*) / 2 FROM t)) median FROM t`,
      since7,
    );
    const onlineNow = this.onlineNow();
    const totals = {
      visitors: get<{ n: number }>('SELECT count(*) n FROM visitors').n,
      accounts: get<{ n: number }>('SELECT count(*) n FROM users').n,
      onlineMatches: get<{ n: number }>('SELECT count(*) n FROM matches').n,
      games: get<{ n: number }>("SELECT count(*) n FROM events WHERE name = 'play'").n,
    };
    const system = all(
      `SELECT at, cpu, mem_used memUsed, mem_total memTotal, disk_used diskUsed, disk_total diskTotal, load1, lag_ms lagMs, rss, net_rx netRx, net_tx netTx, playing
       FROM system_samples WHERE at >= ? ORDER BY at`,
      now - DAY_MS,
    );

    return {
      at: now,
      onlineNow,
      totals,
      stay: { avgSeconds: stay?.avg ?? 0, medianSeconds: stay?.median ?? 0 },
      days: Object.entries(days).map(([day, v]) => ({ day, ...v })),
      sources,
      modes,
      clicks,
      system: { now: this.liveNow().system, last24h: system },
    };
  }
}
