import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  sanitizeHandling,
  sanitizePrefs,
  type Handling,
  type LeaderboardEntry,
  type MatchMode,
  type MatchSummary,
  type Me,
  type OnlineReplay,
  type Prefs,
  type Profile,
  type PublicRating,
  type RatingChange,
  type Region,
} from '@line-battle/engine';
import { DEFAULT_RATING, idleRd, PERIOD_MS, rateMatch, type Rating } from './glicko';
import { tokenHash } from './passwords';

/** A rating counts for the leaderboard once its deviation is this low. */
export const SETTLED_RD = 110;
/** Sessions nobody has used for this long stop working. */
export const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const LEADERBOARD_SIZE = 100;
const RECENT_MATCHES = 20;

/** A signed-in player, as the rooms see them. */
export interface User {
  id: number;
  name: string;
  region: Region;
  handling: Handling | null;
  prefs: Prefs | null;
  /** Current rating, with the deviation already widened for time away. */
  rating: Rating;
  games: number;
  wins: number;
}

interface UserRow {
  id: number;
  name: string;
  password: string;
  region: string;
  handling: string | null;
  prefs: string | null;
  rating: number;
  rd: number;
  vol: number;
  rated_at: number | null;
  games: number;
  wins: number;
}

interface MatchRow {
  id: number;
  mode: string;
  ended_at: number;
  user0: number | null;
  user1: number | null;
  name0: string;
  name1: string;
  score0: number;
  score1: number;
  winner: number | null;
  reason: string;
  before0: number | null;
  after0: number | null;
  before1: number | null;
  after1: number | null;
}

export interface MatchRecord {
  mode: MatchMode;
  region: Region;
  users: [number | null, number | null];
  names: [string, string];
  score: [number, number];
  winner: 0 | 1 | null;
  reason: string;
  /** False for a match that doesn't count, such as one the server rejected inputs in. */
  rated: boolean;
  replay: Omit<OnlineReplay, 'matchId'>;
}

export function publicRating(r: Rating): PublicRating {
  return { rating: Math.round(r.rating), rd: Math.round(r.rd), settled: r.rd <= SETTLED_RD };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  region TEXT NOT NULL,
  handling TEXT,
  rating REAL NOT NULL,
  rd REAL NOT NULL,
  vol REAL NOT NULL,
  rated_at INTEGER,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL,
  region TEXT NOT NULL,
  ended_at INTEGER NOT NULL,
  user0 INTEGER REFERENCES users(id),
  user1 INTEGER REFERENCES users(id),
  name0 TEXT NOT NULL,
  name1 TEXT NOT NULL,
  score0 INTEGER NOT NULL,
  score1 INTEGER NOT NULL,
  winner INTEGER,
  reason TEXT NOT NULL,
  before0 REAL, after0 REAL, before1 REAL, after1 REAL,
  replay TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_user0 ON matches(user0, ended_at);
CREATE INDEX IF NOT EXISTS matches_user1 ON matches(user1, ended_at);
`;

/**
 * Accounts, sessions, ratings and match history, in one SQLite file. It is
 * plenty for one game server; the methods are the seam for moving to
 * PostgreSQL when there are several.
 */
export class Store {
  readonly db: DatabaseSync;

  /** `path` is a file, or ":memory:" for tests. `now` can be swapped in tests. */
  constructor(path: string, private now: () => number = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;');
    this.db.exec(SCHEMA);
    this.migrate();
  }

/** Columns added after the first release; SQLite has no ADD COLUMN IF NOT EXISTS. */
  private migrate(): void {
    const columns = (this.db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
    if (!columns.includes('prefs')) this.db.exec('ALTER TABLE users ADD COLUMN prefs TEXT');
  }

  close(): void {
    this.db.close();
  }

  // ---- accounts ---------------------------------------------------------

  nameTaken(name: string): boolean {
    return this.db.prepare('SELECT 1 FROM users WHERE name = ?').get(name) !== undefined;
  }

  /** Null when the name is taken. `passwordHash` comes from hashPassword. */
  createUser(name: string, passwordHash: string, region: Region): User | null {
    const r = DEFAULT_RATING;
    try {
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO users (name, password, created_at, region, rating, rd, vol) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(name, passwordHash, this.now(), region, r.rating, r.rd, r.vol);
      return this.userById(Number(lastInsertRowid));
    } catch (e) {
      if (String(e).includes('UNIQUE')) return null;
      throw e;
    }
  }

  /** The stored password hash and user, for a login. */
  credentials(name: string): { user: User; passwordHash: string } | null {
    const row = this.db.prepare('SELECT * FROM users WHERE name = ?').get(name) as UserRow | undefined;
    return row ? { user: this.toUser(row), passwordHash: row.password } : null;
  }

  userById(id: number): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? this.toUser(row) : null;
  }

  saveSettings(userId: number, settings: { handling?: Handling; region?: Region; prefs?: Prefs }): void {
    if (settings.prefs) this.db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(settings.prefs), userId);
    if (settings.handling) this.db.prepare('UPDATE users SET handling = ? WHERE id = ?').run(JSON.stringify(settings.handling), userId);
    if (settings.region) this.db.prepare('UPDATE users SET region = ? WHERE id = ?').run(settings.region, userId);
  }

  me(user: User): Me {
    return {
      id: user.id,
      name: user.name,
      region: user.region,
      handling: user.handling,
      prefs: user.prefs,
      rating: publicRating(user.rating),
      games: user.games,
      wins: user.wins,
    };
  }

  private toUser(row: UserRow): User {
    let handling: Handling | null = null;
    let prefs: Prefs | null = null;
    try {
      handling = row.handling ? sanitizeHandling(JSON.parse(row.handling)) : null;
      prefs = row.prefs ? sanitizePrefs(JSON.parse(row.prefs)) : null;
    } catch {
      /* a broken value just falls back to the browser's own */
    }
    const stored: Rating = { rating: row.rating, rd: row.rd, vol: row.vol };
    const idle = row.rated_at === null ? 0 : Math.floor((this.now() - row.rated_at) / PERIOD_MS);
    return {
      id: row.id,
      name: row.name,
      region: row.region as Region,
      handling,
      prefs,
      rating: { ...stored, rd: idleRd(stored, idle) },
      games: row.games,
      wins: row.wins,
    };
  }

  // ---- sessions ---------------------------------------------------------

  createSession(userId: number, token: string): void {
    const now = this.now();
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)').run(tokenHash(token), userId, now, now);
  }

  /** The user a session token belongs to, or null if it is unknown or expired. */
  userForToken(token: string | null | undefined): User | null {
    if (!token) return null;
    const hash = tokenHash(token);
    const row = this.db.prepare('SELECT user_id, last_seen FROM sessions WHERE token_hash = ?').get(hash) as
      | { user_id: number; last_seen: number }
      | undefined;
    if (!row) return null;
    const now = this.now();
    if (now - row.last_seen > SESSION_TTL_MS) {
      this.deleteSession(token);
      return null;
    }
    // Only write when it moved noticeably, so every request isn't a write.
    if (now - row.last_seen > 60_000) this.db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, hash);
    return this.userById(row.user_id);
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  }

  // ---- matches ----------------------------------------------------------

  /**
   * Saves a finished match and, for a rated ranked match between two
   * accounts, updates both ratings. Returns the match id and each side's
   * rating change (null when ratings didn't move).
   */
  recordMatch(m: MatchRecord): { matchId: number; changes: [RatingChange, RatingChange] | null } {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const [u0, u1] = m.users.map((id) => (id === null ? null : this.userById(id)));
      let changes: [RatingChange, RatingChange] | null = null;
      const rated = m.mode === 'ranked' && m.rated && m.winner !== null && u0 && u1 && u0.id !== u1.id;
      if (rated) {
        const players = [u0, u1] as const;
        const after = players.map((u, i) => rateMatch(u.rating, players[1 - i].rating, m.winner === i ? 1 : 0));
        const now = this.now();
        players.forEach((u, i) => {
          this.db
            .prepare('UPDATE users SET rating = ?, rd = ?, vol = ?, rated_at = ?, games = games + 1, wins = wins + ? WHERE id = ?')
            .run(after[i].rating, after[i].rd, after[i].vol, now, m.winner === i ? 1 : 0, u.id);
        });
        changes = [0, 1].map((i) => ({ before: publicRating(players[i].rating), after: publicRating(after[i]) })) as [RatingChange, RatingChange];
      }
      const values: SQLInputValue[] = [
        m.mode, m.region, this.now(), m.users[0], m.users[1], m.names[0], m.names[1], m.score[0], m.score[1], m.winner, m.reason,
        changes ? changes[0].before.rating : null, changes ? changes[0].after.rating : null,
        changes ? changes[1].before.rating : null, changes ? changes[1].after.rating : null,
        JSON.stringify(m.replay),
      ];
      const { lastInsertRowid } = this.db
        .prepare(
          `INSERT INTO matches (mode, region, ended_at, user0, user1, name0, name1, score0, score1, winner, reason, before0, after0, before1, after1, replay)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...values);
      this.db.exec('COMMIT');
      return { matchId: Number(lastInsertRowid), changes };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  replay(matchId: number): OnlineReplay | null {
    const row = this.db.prepare('SELECT replay FROM matches WHERE id = ?').get(matchId) as { replay: string } | undefined;
    return row ? { ...(JSON.parse(row.replay) as Omit<OnlineReplay, 'matchId'>), matchId } : null;
  }

  recentMatches(userId: number, limit = RECENT_MATCHES): MatchSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM matches WHERE user0 = ? OR user1 = ? ORDER BY ended_at DESC, id DESC LIMIT ?')
      .all(userId, userId, limit) as unknown as MatchRow[];
    return rows.map((r) => ({
      id: r.id,
      mode: r.mode as MatchMode,
      endedAt: r.ended_at,
      names: [r.name0, r.name1],
      score: [r.score0, r.score1],
      winner: r.winner === null ? null : (r.winner as 0 | 1),
      reason: r.reason,
      ratings:
        r.before0 === null
          ? null
          : [
              [Math.round(r.before0), Math.round(r.after0!)],
              [Math.round(r.before1!), Math.round(r.after1!)],
            ],
      side: r.user0 === userId ? 0 : 1,
    }));
  }

  // ---- profiles and the leaderboard ---------------------------------------

  /** Settled players, best first. Deviations widen with time away, so this is worked out on read. */
  leaderboard(limit = LEADERBOARD_SIZE): LeaderboardEntry[] {
    const rows = this.db.prepare('SELECT * FROM users WHERE games > 0 ORDER BY rating DESC LIMIT 2000').all() as unknown as UserRow[];
    return rows
      .map((r) => this.toUser(r))
      .filter((u) => u.rating.rd <= SETTLED_RD)
      .slice(0, limit)
      .map((u, i) => ({ rank: i + 1, name: u.name, region: u.region, rating: Math.round(u.rating.rating), rd: Math.round(u.rating.rd), games: u.games }));
  }

  profile(name: string): Profile | null {
    const row = this.db.prepare('SELECT * FROM users WHERE name = ?').get(name) as UserRow | undefined;
    if (!row) return null;
    const user = this.toUser(row);
    const rank = this.leaderboard(2000).find((e) => e.name === user.name)?.rank ?? null;
    return {
      name: user.name,
      region: user.region,
      rating: publicRating(user.rating),
      games: user.games,
      wins: user.wins,
      rank,
      recent: this.recentMatches(user.id),
    };
  }
}
