import type {
  CheckoutResponse,
  Handling,
  ItemId,
  LeaderboardEntry,
  MatchSummary,
  Me,
  OnlineReplay,
  Prefs,
  Profile,
  Region,
  SessionResponse,
  ShopInfo,
} from '@line-battle/engine';

const TOKEN_KEY = 'lineBattle.session';
const configuredServer: string = import.meta.env.VITE_SERVER_URL || '';

/**
 * Where the HTTP API is. Normally the page's own address: Caddy forwards
 * /api to the match server, and so does the Vite dev server. A built page
 * pointed at a match server elsewhere by a full VITE_SERVER_URL asks it directly.
 */
export const API_BASE =
  !import.meta.env.DEV && /^wss?:\/\//.test(configuredServer) ? configuredServer.replace(/^ws/, 'http').replace(/\/$/, '') : '';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* the session just won't survive a reload */
  }
}

/** The signed-in account, if any, and the calls that need it. */
export class Account {
  token: string | null = readToken();
  me: Me | null = null;
  private listeners: (() => void)[] = [];

  /** Called whenever `me` changes (sign in, sign out, new rating). */
  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  get signedIn(): boolean {
    return this.me !== null;
  }

  /** Checks a saved session on page load. */
  async restore(): Promise<void> {
    if (!this.token) return;
    try {
      this.setMe(await this.call<Me>('GET', '/api/me'));
    } catch (e) {
      // Only a rejected session signs you out; a server that's down might be back soon.
      if (e instanceof ApiError && e.status === 401) this.signOutLocally();
    }
  }

  async signUp(name: string, password: string, region: Region, handling: Handling, prefs: Prefs): Promise<Me> {
    return this.startSession(await this.call<SessionResponse>('POST', '/api/signup', { name, password, region, handling, prefs }));
  }

  async logIn(name: string, password: string): Promise<Me> {
    return this.startSession(await this.call<SessionResponse>('POST', '/api/login', { name, password }));
  }

  async logOut(): Promise<void> {
    const token = this.token;
    this.signOutLocally();
    if (token) await fetch(`${API_BASE}/api/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
  }

  /** Saves handling, region and prefs to the account, so they follow you to other browsers. */
  async saveSettings(settings: { handling?: Handling; region?: Region; prefs?: Prefs }): Promise<void> {
    if (!this.signedIn) return;
    try {
      this.setMe(await this.call<Me>('POST', '/api/me/settings', settings));
    } catch {
      /* kept locally; the next save tries again */
    }
  }

  async refresh(): Promise<void> {
    if (this.signedIn) await this.restore();
  }

  profile(name: string): Promise<Profile> {
    return this.call<Profile>('GET', `/api/profile/${encodeURIComponent(name)}`);
  }

  myMatches(): Promise<MatchSummary[]> {
    return this.call<MatchSummary[]>('GET', '/api/me/matches');
  }

  leaderboard(): Promise<LeaderboardEntry[]> {
    return this.call<LeaderboardEntry[]>('GET', '/api/leaderboard');
  }

  replay(matchId: number): Promise<OnlineReplay> {
    return this.call<OnlineReplay>('GET', `/api/matches/${matchId}/replay`);
  }

  shop(): Promise<ShopInfo> {
    return this.call<ShopInfo>('GET', '/api/shop');
  }

  /** Buys an item with gems; `me` then has it, and fewer gems. */
  async buy(item: ItemId): Promise<void> {
    this.setMe(await this.call<Me>('POST', '/api/shop/buy', { item }));
  }

  /** The payment page for a gem pack. */
  async checkout(pack: string, currency: 'vnd' | 'usd'): Promise<string> {
    return (await this.call<CheckoutResponse>('POST', '/api/shop/checkout', { pack, currency })).url;
  }

  private startSession(res: SessionResponse): Me {
    this.token = res.token;
    writeToken(res.token);
    this.setMe(res.me);
    return res.me;
  }

  private signOutLocally(): void {
    this.token = null;
    writeToken(null);
    this.setMe(null);
  }

  private setMe(me: Me | null): void {
    this.me = me;
    for (const fn of this.listeners) fn();
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new ApiError(res.status, data?.error ?? `The server answered ${res.status}.`);
    return data as T;
  }
}
