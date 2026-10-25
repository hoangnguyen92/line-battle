import { createEndpoint } from '@colyseus/core';
import {
  isRegion,
  MAX_PASSWORD,
  MIN_PASSWORD,
  NAME_PATTERN,
  sanitizeHandling,
  type Me,
  type SessionResponse,
} from '@line-battle/engine';
import { checkPassword, hashPassword, newToken } from './passwords';
import type { Store, User } from './store';

export interface ApiRequest {
  method: string;
  /** e.g. "/api/login", without the query string. */
  path: string;
  /** The bearer token from the Authorization header, if any. */
  token: string | null;
  body: unknown;
  ip: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

/** Sign-up and login attempts allowed per address per window. */
export const AUTH_ATTEMPTS = 10;
export const AUTH_WINDOW_MS = 60_000;

const ok = (body: unknown, status = 200): ApiResponse => ({ status, body });
const fail = (status: number, error: string): ApiResponse => ({ status, body: { error } });

/** Counts recent attempts per key, to slow down password guessing. */
class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private limit: number, private windowMs: number, private now: () => number) {}

  allow(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Keep the map from growing without bound on a long-running server.
    if (this.hits.size > 10_000) this.hits.clear();
    return true;
  }
}

/**
 * The game's HTTP API: accounts, settings sync, profiles, the leaderboard
 * and replays. Plain request in, plain response out, so it can be tested
 * without a server.
 */
export class Api {
  private limiter: RateLimiter;

  constructor(private store: Store, now: () => number = Date.now) {
    this.limiter = new RateLimiter(AUTH_ATTEMPTS, AUTH_WINDOW_MS, now);
  }

  async handle(req: ApiRequest): Promise<ApiResponse> {
    try {
      return await this.route(req);
    } catch (e) {
      console.error('api error', e);
      return fail(500, 'Something went wrong on the server.');
    }
  }

  private async route(req: ApiRequest): Promise<ApiResponse> {
    const { method, path } = req;
    const parts = path.replace(/\/+$/, '').split('/').slice(2).map(decodeURIComponent);
    const [a, b, c] = parts;
    if (method === 'POST' && a === 'signup' && parts.length === 1) return this.signup(req);
    if (method === 'POST' && a === 'login' && parts.length === 1) return this.login(req);
    if (method === 'POST' && a === 'logout' && parts.length === 1) return this.logout(req);
    if (method === 'GET' && a === 'me' && parts.length === 1) return this.withUser(req, (u) => ok(this.store.me(u)));
    if (method === 'POST' && a === 'me' && b === 'settings' && parts.length === 2) return this.withUser(req, (u) => this.settings(u, req.body));
    if (method === 'GET' && a === 'me' && b === 'matches' && parts.length === 2) return this.withUser(req, (u) => ok(this.store.recentMatches(u.id)));
    if (method === 'GET' && a === 'profile' && b && parts.length === 2) {
      const profile = this.store.profile(b);
      return profile ? ok(profile) : fail(404, 'No player with that name.');
    }
    if (method === 'GET' && a === 'leaderboard' && parts.length === 1) return ok(this.store.leaderboard());
    if (method === 'GET' && a === 'matches' && b && c === 'replay' && parts.length === 3) {
      const id = Number(b);
      const replay = Number.isInteger(id) ? this.store.replay(id) : null;
      return replay ? ok(replay) : fail(404, 'No such match.');
    }
    return fail(404, 'Not found.');
  }

  private withUser(req: ApiRequest, fn: (user: User) => ApiResponse): ApiResponse {
    const user = this.store.userForToken(req.token);
    return user ? fn(user) : fail(401, 'Please log in again.');
  }

  private async signup(req: ApiRequest): Promise<ApiResponse> {
    if (!this.limiter.allow(req.ip)) return fail(429, 'Too many attempts. Wait a minute and try again.');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!NAME_PATTERN.test(name)) return fail(400, 'Names are 3-16 letters, digits, "_", "-" or ".".');
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return fail(400, `Passwords need at least ${MIN_PASSWORD} characters.`);
    if (this.store.nameTaken(name)) return fail(409, 'That name is taken.');
    const region = isRegion(body.region) ? body.region : 'asia';
    const user = this.store.createUser(name, await hashPassword(password), region);
    if (!user) return fail(409, 'That name is taken.');
    if (body.handling) this.store.saveSettings(user.id, { handling: sanitizeHandling(body.handling) });
    return ok(this.startSession(user.id), 201);
  }

  private async login(req: ApiRequest): Promise<ApiResponse> {
    if (!this.limiter.allow(req.ip)) return fail(429, 'Too many attempts. Wait a minute and try again.');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const password = typeof body.password === 'string' ? body.password.slice(0, MAX_PASSWORD) : '';
    const found = name ? this.store.credentials(name) : null;
    // Same answer either way, so names can't be probed through the login form.
    if (!found || !(await checkPassword(password, found.passwordHash))) return fail(401, 'Wrong name or password.');
    return ok(this.startSession(found.user.id));
  }

  private logout(req: ApiRequest): ApiResponse {
    if (req.token) this.store.deleteSession(req.token);
    return ok({ ok: true });
  }

  private settings(user: User, body: unknown): ApiResponse {
    const b = (body ?? {}) as Record<string, unknown>;
    this.store.saveSettings(user.id, {
      handling: b.handling === undefined ? undefined : sanitizeHandling(b.handling),
      region: isRegion(b.region) ? b.region : undefined,
    });
    return ok(this.store.me(this.store.userById(user.id)!));
  }

  private startSession(userId: number): SessionResponse {
    const token = newToken();
    this.store.createSession(userId, token);
    const me: Me = this.store.me(this.store.userById(userId)!);
    return { token, me };
  }
}

/** The bearer token in an Authorization header. */
export function bearer(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return m ? m[1] : null;
}

/** The player's address: behind Caddy it comes from X-Forwarded-For. */
export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0].trim() || headers.get('x-real-ip') || 'local';
}

/** Mounts the API under /api on the Colyseus server's router. */
export function apiEndpoint(api: Api) {
  return createEndpoint('/api/**', { method: ['GET', 'POST'], requireRequest: true }, async (ctx) => {
    const request = ctx.request as Request;
    const res = await api.handle({
      method: request.method,
      path: new URL(request.url).pathname,
      token: bearer(request.headers.get('authorization')),
      body: ctx.body,
      ip: clientIp(request.headers),
    });
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  });
}
