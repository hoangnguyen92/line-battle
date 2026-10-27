// The owner's dashboard: play statistics, the server's health and video
// numbers, from /api/admin/dashboard. The key is ADMIN_KEY on the server.

const KEY_STORE = 'lineBattle.adminKey';
const REFRESH_MS = 30_000;
/** The "right now" tiles and live charts update this often. */
const LIVE_MS = 3_000;
/** Live readings kept for the live charts: 5 minutes. */
const LIVE_POINTS = 100;

interface SystemSample {
  at: number;
  cpu: number;
  memUsed: number;
  memTotal: number;
  diskUsed: number;
  diskTotal: number;
  load1: number;
  lagMs: number;
  rss: number;
  netRx: number;
  netTx: number;
  playing: number;
}

interface Dashboard {
  at: number;
  onlineNow: number;
  totals: { visitors: number; accounts: number; onlineMatches: number; games: number };
  stay: { avgSeconds: number; medianSeconds: number };
  days: { day: string; visitors?: number; newVisitors?: number; returning?: number; players?: number; games?: number; minutes?: number; signups?: number; onlineMatches?: number }[];
  sources: { source: string; visitors: number; players: number; minutes: number }[];
  modes: { mode: string; games: number; finished: number; quit: number; avgSeconds: number | null }[];
  clicks: { button: string; clicks: number; visitors: number }[];
  system: {
    now: {
      cpu: number; memUsed: number; memTotal: number; diskUsed: number; diskTotal: number; load: number[]; cores: number;
      lagMs: number; rss: number; netRx: number; netTx: number; playing: number; uptimeHost: number; uptimeServer: number; dbBytes: number;
    };
    last24h: SystemSample[];
  };
  social: { day: string; platform: string; views: number; likes: number; comments: number; followers: number }[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The game's button ids, in words. */
const BUTTONS: Record<string, string> = {
  'open-account': 'Đăng nhập / đăng ký',
  'open-profile': 'Hồ sơ và bảng xếp hạng',
  'log-out': 'Đăng xuất',
  start: 'Sprint 40 hàng',
  'start-versus': '2 người 1 máy',
  'start-tutorial': 'Cách chơi',
  'start-bot': 'Đấu bot',
  'start-gauntlet': 'Gauntlet',
  'online-ranked': 'Online: xếp hạng',
  'online-quick': 'Online: trận nhanh',
  'online-create': 'Online: tạo phòng',
  'online-join': 'Online: vào phòng',
  'open-customize': 'Nhân vật, skin, shop',
  'open-controls': 'Phím điều khiển',
  'open-settings': 'Handling',
  'open-sound': 'Âm thanh',
  'tutorial-bot': 'Hướng dẫn xong: đấu bot',
  'tutorial-skip': 'Bỏ qua hướng dẫn',
  'log-in': 'Đăng nhập',
  'sign-up': 'Tạo tài khoản',
  'lobby-cancel': 'Huỷ tìm trận',
  retry: 'Chơi lại / rematch',
  'to-menu': 'Về menu',
  'download-replay': 'Tải replay',
};

function modeName(mode: string): string {
  const m = /^(bot|gauntlet)-(\d)$/.exec(mode);
  if (m) return m[1] === 'bot' ? `Đấu bot cấp ${m[2]}` : `Gauntlet, bot ${m[2]}`;
  return (
    {
      sprint: 'Sprint 40 hàng',
      tutorial: 'Hướng dẫn',
      versus: '2 người 1 máy',
      'online-quick': 'Online: trận nhanh',
      'online-ranked': 'Online: xếp hạng',
      'online-room': 'Online: phòng riêng',
    }[mode] ?? mode
  );
}

const fmt = (n: number | undefined | null) => (n ?? 0).toLocaleString('vi-VN');
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '–');

function bytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

function duration(seconds: number | null | undefined): string {
  const s = Math.round(seconds ?? 0);
  if (s < 60) return `${s} giây`;
  if (s < 3600) return `${Math.floor(s / 60)} phút ${s % 60 ? `${s % 60} giây` : ''}`.trim();
  const h = Math.floor(s / 3600);
  return h < 48 ? `${h} giờ ${Math.floor((s % 3600) / 60)} phút` : `${Math.floor(h / 24)} ngày`;
}

function el(tag: string, text = '', cls = ''): HTMLElement {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function tile(label: string, value: string, sub = '', tone = ''): HTMLElement {
  const t = el('div', '', `tile ${tone}`);
  t.append(el('div', label, 'label'), el('div', value, 'value'));
  if (sub) t.append(el('div', sub, 'sub'));
  return t;
}

/** Red past `bad`, yellow past `warn`, as a share from 0 to 1. */
function tone(share: number, warn = 0.7, bad = 0.9): string {
  return share >= bad ? 'bad' : share >= warn ? 'warn' : 'good';
}

function table(target: HTMLTableElement, head: string[], rows: (string | Node)[][], empty = 'Chưa có dữ liệu'): void {
  target.replaceChildren();
  const tr = el('tr');
  for (const h of head) tr.append(el('th', h));
  target.append(tr);
  if (rows.length === 0) {
    const r = el('tr');
    const td = el('td', empty, 'muted');
    td.setAttribute('colspan', String(head.length));
    r.append(td);
    target.append(r);
    return;
  }
  for (const row of rows) {
    const r = el('tr');
    for (const cell of row) {
      const td = el('td');
      td.append(cell);
      r.append(td);
    }
    target.append(r);
  }
}

function withBar(text: string, value: number, max: number, width = 90): Node {
  const span = el('span');
  const bar = el('span', '', 'bar');
  bar.style.width = `${max > 0 ? Math.max(2, (value / max) * width) : 0}px`;
  span.append(bar, text);
  return span;
}

/** A small line chart of one series. */
function chart(title: string, now: string, points: number[], max: number | null, color: string): HTMLElement {
  const box = el('div', '', 'chart');
  const head = el('div', '', 'head');
  head.append(el('span', title), el('b', now));
  box.append(head);
  const W = 300;
  const H = 70;
  const top = Math.max(max ?? 0, ...points, 1e-9);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  if (points.length > 1) {
    const xy = points.map((p, i) => `${((i / (points.length - 1)) * W).toFixed(1)},${(H - 2 - (p / top) * (H - 4)).toFixed(1)}`);
    const area = document.createElementNS(svg.namespaceURI, 'polygon');
    area.setAttribute('points', `0,${H} ${xy.join(' ')} ${W},${H}`);
    area.setAttribute('fill', color);
    area.setAttribute('fill-opacity', '0.15');
    const line = document.createElementNS(svg.namespaceURI, 'polyline');
    line.setAttribute('points', xy.join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(area, line);
  }
  box.append(svg);
  return box;
}

type SystemNow = Dashboard['system']['now'];
const liveHistory: SystemNow[] = [];

function renderNow(s: SystemNow, onlineNow: number, at: number): void {
  const memShare = s.memUsed / s.memTotal;
  const diskShare = s.diskTotal ? s.diskUsed / s.diskTotal : 0;
  $('now').replaceChildren(
    tile('Đang mở game', fmt(onlineNow), 'người, trong 1 phút qua'),
    tile('Đang đấu online', fmt(s.playing), 'người trong trận'),
    tile('CPU', `${s.cpu}%`, `${s.cores} nhân, load ${s.load.join(' / ')}`, tone(s.cpu / 100)),
    tile('RAM', pct(s.memUsed, s.memTotal), `${bytes(s.memUsed)} / ${bytes(s.memTotal)}`, tone(memShare, 0.8, 0.92)),
    tile('Ổ đĩa', pct(s.diskUsed, s.diskTotal), `${bytes(s.diskUsed)} / ${bytes(s.diskTotal)}`, tone(diskShare, 0.75, 0.9)),
    tile('Mạng', `${bytes(s.netTx)}/s`, `ra; vào ${bytes(s.netRx)}/s`),
    tile('Độ trễ server', `${s.lagMs} ms`, 'event loop, p99', s.lagMs > 100 ? 'bad' : s.lagMs > 40 ? 'warn' : 'good'),
    tile('Server game', bytes(s.rss), `RAM; chạy ${duration(s.uptimeServer)}`),
    tile('Database', bytes(s.dbBytes), `máy chạy ${duration(s.uptimeHost)}`),
  );
  liveHistory.push(s);
  if (liveHistory.length > LIVE_POINTS) liveHistory.shift();
  const h = liveHistory;
  $('live').replaceChildren(
    chart('CPU %', `${s.cpu}%`, h.map((x) => x.cpu), 100, '#7c6cf0'),
    chart('RAM %', pct(s.memUsed, s.memTotal), h.map((x) => (x.memUsed / x.memTotal) * 100), 100, '#3ccf8e'),
    chart('Người đấu online', fmt(s.playing), h.map((x) => x.playing), null, '#f5c043'),
    chart('Mạng ra (KB/s)', `${bytes(s.netTx)}/s`, h.map((x) => x.netTx / 1024), null, '#5bb8f0'),
  );
  $('live-time').textContent = new Date(at).toLocaleTimeString('vi-VN');
}

function render(d: Dashboard): void {
  const s = d.system.now;
  renderNow(s, d.onlineNow, d.at);

  const h = d.system.last24h;
  $('charts').replaceChildren(
    chart('CPU %', `${s.cpu}%`, h.map((x) => x.cpu), 100, '#7c6cf0'),
    chart('RAM %', pct(s.memUsed, s.memTotal), h.map((x) => (x.memUsed / x.memTotal) * 100), 100, '#3ccf8e'),
    chart('Người đấu online', fmt(s.playing), h.map((x) => x.playing), null, '#f5c043'),
    chart('Mạng ra (KB/s)', `${bytes(s.netTx)}/s`, h.map((x) => x.netTx / 1024), null, '#5bb8f0'),
    chart('Độ trễ server (ms)', `${s.lagMs} ms`, h.map((x) => x.lagMs), null, '#f0596a'),
    chart('Ổ đĩa %', pct(s.diskUsed, s.diskTotal), h.map((x) => (x.diskTotal ? (x.diskUsed / x.diskTotal) * 100 : 0)), 100, '#c38cf0'),
  );

  const today = d.days[d.days.length - 1];
  const week = d.days.slice(-7);
  const sum = (k: keyof (typeof d.days)[number]) => week.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  $('players').replaceChildren(
    tile('Lượt người vào hôm nay', fmt(today?.visitors), `${fmt(today?.newVisitors)} mới, ${fmt(today?.returning)} quay lại`),
    tile('Người vào, 7 ngày', fmt(sum('visitors')), `${fmt(sum('newVisitors'))} người mới`),
    tile('Có chơi ít nhất 1 ván', pct(sum('players'), sum('visitors')), '7 ngày, trên số người vào'),
    tile('Số ván, 7 ngày', fmt(sum('games')), `${fmt(today?.games)} hôm nay`),
    tile('Ở lại mỗi lần vào', duration(d.stay.avgSeconds), `trung vị ${duration(d.stay.medianSeconds)}`),
    tile('Tài khoản', fmt(d.totals.accounts), `${fmt(sum('signups'))} mới trong 7 ngày`),
    tile('Trận online', fmt(d.totals.onlineMatches), `${fmt(sum('onlineMatches'))} trong 7 ngày`),
  );

  const maxVisitors = Math.max(0, ...d.days.map((r) => r.visitors ?? 0));
  table(
    $('days'),
    ['Ngày (giờ VN)', 'Người vào', 'Mới', 'Quay lại', 'Có chơi', 'Số ván', 'Phút ở lại', 'Đăng ký', 'Trận online'],
    // The last 14 days, from the first day with any data.
    d.days
      .slice(-14)
      .filter((_, i, all) => all.slice(0, i + 1).some((x) => Object.keys(x).length > 1))
      .reverse()
      .map((r) => [
      r.day.slice(5).split('-').reverse().join('/'),
      withBar(fmt(r.visitors), r.visitors ?? 0, maxVisitors),
      fmt(r.newVisitors),
      fmt(r.returning),
      fmt(r.players),
      fmt(r.games),
      fmt(r.minutes),
      fmt(r.signups),
      fmt(r.onlineMatches),
    ]),
  );

  const maxSource = Math.max(0, ...d.sources.map((r) => r.visitors));
  table(
    $('sources'),
    ['Nguồn', 'Người', 'Có chơi', 'Phút/người'],
    d.sources.map((r) => [r.source, withBar(fmt(r.visitors), r.visitors, maxSource, 60), pct(r.players, r.visitors), (r.minutes / Math.max(1, r.visitors)).toFixed(1)]),
  );

  table(
    $('modes'),
    ['Chế độ', 'Số ván', 'Chơi hết', 'Bỏ giữa chừng', 'Thời gian TB'],
    d.modes.map((r) => [modeName(r.mode), fmt(r.games), pct(r.finished, r.finished + r.quit), fmt(r.quit), duration(r.avgSeconds)]),
  );

  const maxClicks = Math.max(0, ...d.clicks.map((r) => r.clicks));
  table(
    $('clicks'),
    ['Nút', 'Lượt bấm', 'Số người bấm'],
    d.clicks.map((r) => [
      r.button.startsWith('link:') ? `Link ra ${r.button.slice(5)}` : BUTTONS[r.button] ?? (r.button.startsWith('close-') ? `Đóng ${r.button.slice(6)}` : r.button),
      withBar(fmt(r.clicks), r.clicks, maxClicks),
      fmt(r.visitors),
    ]),
  );

  // Totals per platform per day, with the change since that platform's previous entry.
  const prev = new Map<string, (typeof d.social)[number]>();
  const rows = [...d.social].reverse().map((r) => {
    const p = prev.get(r.platform);
    prev.set(r.platform, r);
    const delta = (k: 'views' | 'likes' | 'comments' | 'followers') => {
      const span = el('span', fmt(r[k]));
      if (p && r[k] > p[k]) span.append(' ', el('span', `+${fmt(r[k] - p[k])}`, 'up'));
      return span;
    };
    return [r.day.split('-').reverse().join('/'), { youtube: 'YouTube', tiktok: 'TikTok', facebook: 'Facebook' }[r.platform] ?? r.platform, delta('views'), delta('likes'), delta('comments'), delta('followers')];
  });
  table($('social'), ['Ngày', 'Nền tảng', 'View', 'Like', 'Comment', 'Follower'], rows.reverse(), 'Chưa nhập số video nào');

  $('updated').textContent = `Cập nhật ${new Date(d.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
}

// ---- loading ---------------------------------------------------------------

function savedKey(): string {
  try {
    return localStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
}

function saveKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORE, key);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    /* asked again next time */
  }
}

let key = savedKey();

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? `HTTP ${res.status}`), { status: res.status });
  return data as T;
}

function showLogin(message = ''): void {
  $('login').classList.remove('hidden');
  $('dash').classList.add('hidden');
  $('logout').classList.add('hidden');
  $('login-error').textContent = message;
  $<HTMLInputElement>('key').focus();
}

async function loadLive(): Promise<void> {
  if (!key || $('dash').classList.contains('hidden')) return;
  try {
    const live = await call<{ at: number; onlineNow: number; system: SystemNow }>('GET', '/api/admin/live');
    renderNow(live.system, live.onlineNow, live.at);
  } catch {
    /* the full refresh reports problems */
  }
}

async function load(): Promise<void> {
  if (!key) return showLogin();
  try {
    render(await call<Dashboard>('GET', '/api/admin/dashboard'));
    $('login').classList.add('hidden');
    $('dash').classList.remove('hidden');
    $('logout').classList.remove('hidden');
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401 || status === 429) {
      saveKey('');
      key = '';
      showLogin((e as Error).message);
    } else if (status === 404) {
      showLogin('Dashboard đang tắt: đặt ADMIN_KEY trong .env của server rồi deploy lại.');
    } else {
      $('updated').textContent = `Không tải được: ${(e as Error).message}`;
    }
  }
}

$('login').addEventListener('submit', (e) => {
  e.preventDefault();
  key = $<HTMLInputElement>('key').value.trim();
  saveKey(key);
  void load();
});
$('logout').addEventListener('click', () => {
  saveKey('');
  key = '';
  showLogin();
});
$('refresh').addEventListener('click', () => void load());

const form = $<HTMLFormElement>('social-form');
(form.elements.namedItem('day') as HTMLInputElement).valueAsDate = new Date();
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
  const button = form.querySelector('button')!;
  button.disabled = true;
  try {
    await call('POST', '/api/admin/social', {
      day: field('day'),
      platform: field('platform'),
      views: Number(field('views')),
      likes: Number(field('likes')),
      comments: Number(field('comments')),
      followers: Number(field('followers')),
    });
    await load();
  } catch (err) {
    alert((err as Error).message);
  } finally {
    button.disabled = false;
  }
});

void load();
setInterval(() => {
  if (key && document.visibilityState === 'visible') void load();
}, REFRESH_MS);
setInterval(() => {
  if (document.visibilityState === 'visible') void loadLive();
}, LIVE_MS);
