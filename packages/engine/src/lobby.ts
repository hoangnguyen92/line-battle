import type { Handling } from './game';
import { StreamPlayer, type MatchMode, type RelayBatch } from './netplay';

// ---- accounts, matchmaking and online replays ------------------------------
// Shapes shared by the match server and the browser.

/**
 * Where a player is, for matchmaking: the queue pairs players in the same
 * region first, and only looks further afield after a while.
 */
export const REGIONS = ['asia', 'oceania', 'europe', 'americas'] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_NAMES: Record<Region, string> = {
  asia: 'Asia',
  oceania: 'Oceania',
  europe: 'Europe and Africa',
  americas: 'Americas',
};

export function isRegion(v: unknown): v is Region {
  return typeof v === 'string' && (REGIONS as readonly string[]).includes(v);
}

/** A guess at the player's region from an IANA time zone such as "Asia/Ho_Chi_Minh". */
export function regionFromTimeZone(tz: string | undefined): Region {
  const area = (tz ?? '').split('/')[0];
  if (area === 'Australia' || area === 'Pacific') return 'oceania';
  if (area === 'Europe' || area === 'Africa' || area === 'Atlantic') return 'europe';
  if (area === 'America' || area === 'US' || area === 'Canada' || area === 'Brazil') return 'americas';
  return 'asia';
}

/** Account names: 3-16 letters, digits, "_", "-" or ".". */
export const NAME_PATTERN = /^[\p{L}\p{N}_.-]{3,16}$/u;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 128;

/** A rating as players see it. */
export interface PublicRating {
  rating: number;
  rd: number;
  /** False while the deviation is still high: the rating is a guess so far. */
  settled: boolean;
}

/** One of your own account's details, from GET /api/me. */
export interface Me {
  id: number;
  name: string;
  region: Region;
  handling: Handling | null;
  rating: PublicRating;
  games: number;
  wins: number;
}

export interface MatchSummary {
  id: number;
  mode: MatchMode;
  endedAt: number;
  names: [string, string];
  score: [number, number];
  winner: 0 | 1 | null;
  reason: string;
  /** Rating before and after, for each side, in a ranked match. */
  ratings: [[number, number], [number, number]] | null;
  /** Which side the profile's player was on. */
  side: 0 | 1;
}

export interface Profile {
  name: string;
  region: Region;
  rating: PublicRating;
  games: number;
  wins: number;
  /** Place on the leaderboard, once the rating is settled. */
  rank: number | null;
  recent: MatchSummary[];
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  region: Region;
  rating: number;
  rd: number;
  games: number;
}

/** POST /api/signup and /api/login answer with a session token. */
export interface SessionResponse {
  token: string;
  me: Me;
}

export type QueueKind = 'ranked' | 'quick';

/** Options a client passes when it joins the matchmaking queue. */
export interface QueueJoinOptions {
  queue: QueueKind;
  region: Region;
  /** Only for guests in quick match; an account's name comes from the account. */
  name: string;
  handling: Handling;
}

/** Queue server to client messages. */
export interface QueueMessages {
  /** Sent on joining and every few seconds while waiting. */
  searching: { waitedMs: number; region: Region; rating: number; range: number; anyRegion: boolean; inQueue: number };
  /** An opponent was found: join the match with this seat reservation. */
  matched: { reservation: unknown };
}

/** After a ranked match: your rating before and after. */
export interface RatingChange {
  before: PublicRating;
  after: PublicRating;
}

// ---- online replays ---------------------------------------------------------

export interface OnlineRoundReplay {
  seed: number;
  /** Both players' accepted input streams, garbage as line counts. */
  logs: [RelayBatch, RelayBatch];
  winner: 0 | 1 | null;
}

/** A whole online match, as the server refereed it. */
export interface OnlineReplay {
  version: 1;
  kind: 'online';
  matchId: number;
  mode: MatchMode;
  names: [string, string];
  handling: [Handling, Handling];
  rounds: OnlineRoundReplay[];
  score: [number, number];
  winner: 0 | 1 | null;
  reason: string;
}

/** Re-runs one round of an online replay: both boards, as the server saw them. */
export function playOnlineRound(replay: OnlineReplay, round: number): [StreamPlayer, StreamPlayer] {
  const r = replay.rounds[round];
  const players: [StreamPlayer, StreamPlayer] = [
    new StreamPlayer(r.seed, replay.handling[0]),
    new StreamPlayer(r.seed, replay.handling[1]),
  ];
  players.forEach((p, i) => p.push(r.logs[i]));
  return players;
}
