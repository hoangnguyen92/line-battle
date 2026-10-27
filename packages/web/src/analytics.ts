import { API_BASE } from './account';

/**
 * Anonymous play statistics for the game's own dashboard: where visitors
 * came from, which buttons they press, what they play, for how long, and
 * how long they stay. A visitor is a random id kept in this browser; no
 * names, addresses or keystrokes are sent.
 */

const VISITOR_KEY = 'lineBattle.visitor';
const FLUSH_MS = 10_000;
/** Time on the page is sent this often while the tab is open, so the dashboard sees who is online. */
const TIME_FLUSH_MS = 30_000;
/** Events the dashboard shows live go out within this long. */
const SOON_MS = 1_000;

interface TrackedEvent {
  e: string;
  d?: string;
  n?: number;
}

function visitorId(): string {
  try {
    const saved = localStorage.getItem(VISITOR_KEY);
    if (saved && /^[a-z0-9]{16}$/.test(saved)) return saved;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    // Storage blocked: still count this page view, just not as a returning visitor.
    return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  }
}

/** Known sites under one short name, so the dashboard groups them. */
const SITES: [RegExp, string][] = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, 'facebook'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)(itch\.io|itch\.zone)$/, 'itch'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)voz\.vn$/, 'voz'],
  [/(^|\.)zalo\.me$/, 'zalo'],
  [/(^|\.)discord(app)?\.com$/, 'discord'],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'x'],
  [/(^|\.)google\.[a-z.]+$/, 'google'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)coccoc\.com$/, 'coccoc'],
];

/** Where this visit came from: ?ref= or ?utm_source= first, then the referring site. */
export function visitSource(url: string, referrer: string): string {
  const params = new URL(url).searchParams;
  const tagged = (params.get('ref') || params.get('utm_source') || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40);
  if (tagged) return tagged;
  if (!referrer) return 'direct';
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'direct';
  }
  if (host === new URL(url).hostname.replace(/^www\./, '')) return 'direct';
  for (const [pattern, name] of SITES) if (pattern.test(host)) return name;
  return host.slice(0, 40);
}

export class Analytics {
  private readonly visitor = visitorId();
  private queue: TrackedEvent[] = [];
  /** The game being played, and when it started. */
  private game: { label: string; at: number } | null = null;
  private visibleSince: number | null = document.visibilityState === 'visible' ? performance.now() : null;
  private visibleMs = 0;
  private lastTimeFlush = performance.now();
  private soon: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.track('visit', visitSource(location.href, document.referrer));
    // Every button and link with an id, so the dashboard shows what people press.
    document.addEventListener(
      'click',
      (e) => {
        const el = (e.target as Element | null)?.closest('button[id], a[id], a[href^="http"]');
        if (!el) return;
        const name = el.id || `link:${new URL((el as HTMLAnchorElement).href).hostname.replace(/^www\./, '')}`;
        this.track('click', name);
      },
      { capture: true },
    );
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.visibleSince = performance.now();
      } else {
        this.pauseClock();
        this.flush(true);
      }
    });
    addEventListener('pagehide', () => {
      this.endGame('left');
      this.pauseClock();
      this.flush(true);
    });
    setInterval(() => this.flush(false), FLUSH_MS);
  }

  track(e: string, d?: string, n?: number): void {
    if (this.queue.length >= 200) return;
    this.queue.push({ e, ...(d === undefined ? {} : { d }), ...(n === undefined ? {} : { n: Math.round(n) }) });
    if (e !== 'click' && e !== 'time' && !this.soon) {
      this.soon = setTimeout(() => {
        this.soon = null;
        this.flush(false);
      }, SOON_MS);
    }
  }

  /** A game began (or a new one replaced the last). `label` says what is played, e.g. "bot-3". */
  startGame(label: string): void {
    if (this.game?.label === label) return;
    this.endGame('quit');
    this.game = { label, at: performance.now() };
    this.track('play', label);
  }

  /** The game ended: "finished" at the result screen, "quit" back to the menu, "left" closing the page. */
  endGame(how: 'finished' | 'quit' | 'left'): void {
    if (!this.game) return;
    this.track(`game-${how}`, this.game.label, (performance.now() - this.game.at) / 1000);
    this.game = null;
  }

  private pauseClock(): void {
    if (this.visibleSince === null) return;
    this.visibleMs += performance.now() - this.visibleSince;
    this.visibleSince = null;
  }

  private flush(leaving: boolean): void {
    const now = performance.now();
    if (leaving || now - this.lastTimeFlush >= TIME_FLUSH_MS) {
      const running = this.visibleSince === null ? 0 : now - this.visibleSince;
      if (this.visibleSince !== null) this.visibleSince = now;
      const seconds = (this.visibleMs + running) / 1000;
      this.visibleMs = 0;
      this.lastTimeFlush = now;
      if (seconds >= 1) this.track('time', undefined, seconds);
    }
    if (this.queue.length === 0) return;
    const body = JSON.stringify({ v: this.visitor, events: this.queue.splice(0, 50) });
    // keepalive lets the request finish after the tab closes.
    void fetch(`${API_BASE}/api/track`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body }).catch(() => {});
  }
}
