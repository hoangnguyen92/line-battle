import {
  DEFAULT_HANDLING,
  Game,
  Match,
  MatchRecorder,
  randomSeed,
  Recorder,
  SDF_INSTANT,
  TICK_RATE,
  type ClearInfo,
  type GameConfig,
  type KeyEvent,
  type MatchConfig,
  type MatchReplay,
  type Replay,
} from '@line-battle/engine';
import { BOT_HANDLING, BotController, LEVEL_IDS, LEVELS, type LevelId } from '@line-battle/bot';
import { BotWorker } from './bot-client';
import { CharacterView } from './character';
import { Keyboard, P1_BINDINGS, P2_BINDINGS, SOLO_BINDINGS } from './input';
import { describeEnd, OnlineMatch, type JoinKind, type OnlinePhase } from './online';
import { formatTime, PLAYER_COLORS, Renderer, type Popup } from './render';
import {
  loadBestTicks,
  loadBotLevel,
  loadGauntletBest,
  loadHandling,
  loadName,
  saveBestTicks,
  saveBotLevel,
  saveGauntletBest,
  saveHandling,
  saveName,
} from './settings';

const SPRINT_LINES = 40;
const ROUNDS_TO_WIN = 2;
/** How long the end of a round stays on screen before the next one starts. */
const ROUND_END_MS = 2600;
const TICK_MS = 1000 / TICK_RATE;
const COUNTDOWN_STEP_MS = 500;
const COUNTDOWN = ['3', '2', '1'];
/** Never simulate more than this many ticks per frame (e.g. after a tab switch). */
const MAX_CATCH_UP = 8;

/** 'bot' is a match against the bot; the gauntlet is a run of bot matches, levels 1 to 5. */
type Mode = 'sprint' | 'versus' | 'bot' | 'online';
/** 'lobby' covers connecting, waiting for an opponent and connection errors. */
type Screen = 'menu' | 'settings' | 'lobby' | 'countdown' | 'playing' | 'roundEnd' | 'result';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const renderer = new Renderer($<HTMLCanvasElement>('game'));
const soloKeys = new Keyboard(SOLO_BINDINGS);
const versusKeys = [new Keyboard(P1_BINDINGS), new Keyboard(P2_BINDINGS)] as const;
const allKeyboards = [soloKeys, ...versusKeys];

let mode: Mode = 'sprint';
let screen: Screen = 'menu';
let handling = loadHandling();
let countdownStart = 0;
let lastFrame = performance.now();
let accumulator = 0;
let lastReplay: Replay | MatchReplay | null = null;

// Sprint state
let game: Game | null = null;
let recorder: Recorder | null = null;
let popup: Popup | null = null;
/** Keys already held when play starts, fed into the first tick. */
let pendingStart: KeyEvent[] = [];

// Versus state
let match: Match | null = null;
let matchRecorder: MatchRecorder | null = null;
let score: [number, number] = [0, 0];
let popups: [Popup | null, Popup | null] = [null, null];
const characters: [CharacterView, CharacterView] = [new CharacterView(PLAYER_COLORS[0]), new CharacterView(PLAYER_COLORS[1])];
let pendingVersusStart: [KeyEvent[], KeyEvent[]] = [[], []];
let banner: string | null = null;
let roundEndAt = 0;

// Bot state
const botWorker = new BotWorker();
let botLevel: LevelId = loadBotLevel();
let bot: BotController | null = null;
/** Set during a gauntlet run; the bot's level is the current stage. */
let gauntlet = false;

// Online state
let online: OnlineMatch | null = null;
let pendingOnlineStart: KeyEvent[] = [];

// ---- screens --------------------------------------------------------------

function show(next: Screen): void {
  screen = next;
  $('menu').classList.toggle('hidden', next !== 'menu');
  $('settings').classList.toggle('hidden', next !== 'settings');
  $('result').classList.toggle('hidden', next !== 'result');
  $('lobby').classList.toggle('hidden', next !== 'lobby');
  $('download-replay').classList.toggle('hidden', !lastReplay || mode === 'online');
  if (mode !== 'online') $<HTMLButtonElement>('retry').disabled = false;
  if (next === 'menu') refreshBest();
}

function refreshBest(): void {
  const best = loadBestTicks();
  $('best').textContent = best ? formatTime(best) : 'none yet';
  refreshBotMenu();
}

function setMode(next: Mode): void {
  mode = next;
  renderer.setLayout(next === 'sprint' ? 'solo' : 'versus');
}

function refreshBotMenu(): void {
  document.querySelectorAll<HTMLButtonElement>('#bot-levels button').forEach((b) => {
    b.classList.toggle('selected', Number(b.dataset.level) === botLevel);
  });
  const beaten = loadGauntletBest();
  $('gauntlet-best').textContent = beaten === 5 ? 'all 5 bots beaten' : beaten > 0 ? `${beaten} of 5 bots beaten` : 'not started';
}

function startCountdown(): void {
  for (const k of allKeyboards) k.clearPending();
  countdownStart = performance.now();
  show('countdown');
}

function startSprint(): void {
  setMode('sprint');
  const config: GameConfig = { seed: randomSeed(), handling: { ...handling }, goalLines: SPRINT_LINES };
  game = new Game(config);
  recorder = new Recorder(config);
  popup = null;
  startCountdown();
}

function startVersus(): void {
  setMode('versus');
  gauntlet = false;
  bot = null;
  score = [0, 0];
  startRound();
}

/** A match against the bot at `level`. */
function startBotMatch(level: LevelId, inGauntlet: boolean): void {
  setMode('bot');
  gauntlet = inGauntlet;
  bot = new BotController(LEVELS[level], botWorker.planner(level));
  score = [0, 0];
  startRound();
}

function startRound(): void {
  // Both players get the same pieces; a fresh seed each round.
  const second = mode === 'bot' ? BOT_HANDLING : handling;
  const config: MatchConfig = { seed: randomSeed(), players: [{ handling: { ...handling } }, { handling: { ...second } }] };
  bot?.reset();
  match = new Match(config);
  matchRecorder = new MatchRecorder(config);
  popups = [null, null];
  banner = null;
  for (const c of characters) c.reset();
  startCountdown();
}

/** The names over the boards and in the result text. */
function playerNames(): [string, string] {
  if (mode !== 'bot' || !bot) return ['PLAYER 1', 'PLAYER 2'];
  return ['YOU', `${bot.level.name.toUpperCase()} BOT`];
}

function retry(): void {
  if (mode === 'online') return online?.askRematch();
  if (mode === 'sprint') return startSprint();
  if (mode === 'versus') return startVersus();
  if (!gauntlet || !bot) return startBotMatch(bot?.level.id ?? botLevel, false);
  // Gauntlet: after a win go on to the next bot, after a loss start over.
  const won = score[0] > score[1];
  if (won && bot.level.id < 5) startBotMatch((bot.level.id + 1) as LevelId, true);
  else startBotMatch(1, true);
}

function beginPlay(): void {
  // Keys held through the countdown (e.g. DAS charging) count from the first tick.
  for (const k of allKeyboards) k.clearPending();
  pendingStart = soloKeys.heldEvents();
  pendingVersusStart = mode === 'bot' ? [soloKeys.heldEvents(), []] : [versusKeys[0].heldEvents(), versusKeys[1].heldEvents()];
  accumulator = 0;
  show('playing');
}

function endSprint(): void {
  if (!game || !recorder) return;
  lastReplay = recorder.finish(game.tick);
  const title = $('result-title');
  const time = $('result-time');
  const detail = $('result-detail');
  if (game.finished) {
    const best = loadBestTicks();
    const isBest = best === null || game.tick < best;
    if (isBest) saveBestTicks(game.tick);
    title.textContent = isBest ? 'New personal best!' : 'Finished';
    time.textContent = formatTime(game.tick);
    const pps = game.piecesPlaced / (game.tick / TICK_RATE);
    detail.textContent = `${game.piecesPlaced} pieces · ${pps.toFixed(2)} pieces per second` +
      (best !== null && !isBest ? ` · best ${formatTime(best)}` : '');
  } else {
    title.textContent = 'Topped out';
    time.textContent = `${game.lines}/${SPRINT_LINES} lines`;
    detail.textContent = `after ${formatTime(game.tick)}`;
  }
  $('retry').textContent = 'Retry (R)';
  show('result');
}

function endRound(): void {
  if (!match || !matchRecorder) return;
  lastReplay = matchRecorder.finish(match.tick);
  const now = performance.now();
  const result = match.result;
  if (result === 'draw') {
    characters.forEach((c) => c.knockOut(now));
    banner = 'DRAW';
  } else if (result !== null) {
    score[result]++;
    characters[1 - result].knockOut(now);
    const name = playerNames()[result];
    if (mode === 'bot') {
      banner = result === 0 ? (score[0] >= ROUNDS_TO_WIN ? 'YOU WIN!' : 'YOU TAKE THE ROUND') : score[1] >= ROUNDS_TO_WIN ? 'THE BOT WINS' : 'THE BOT TAKES THE ROUND';
    } else {
      banner = score[result] >= ROUNDS_TO_WIN ? `${name} WINS!` : `${name} TAKES THE ROUND`;
    }
  }
  roundEndAt = now;
  show('roundEnd');
}

function showMatchResult(): void {
  if (!match) return;
  if (mode === 'bot') return showBotResult();
  const winner = score[0] > score[1] ? 1 : 2;
  $('result-title').textContent = `Player ${winner} wins!`;
  $('result-time').textContent = `${score[0]} – ${score[1]}`;
  const [a, b] = match.players;
  $('result-detail').textContent = `Last round: P1 sent ${a.attackSent} lines, P2 sent ${b.attackSent} lines`;
  $('retry').textContent = 'Rematch (Enter)';
  show('result');
}

function showBotResult(): void {
  if (!match || !bot) return;
  const won = score[0] > score[1];
  const level = bot.level;
  const [a, b] = match.players;
  let title = won ? `You beat the ${level.name} bot!` : `The ${level.name} bot wins`;
  let retryLabel = 'Rematch (Enter)';
  if (gauntlet) {
    const beaten = won ? level.id : level.id - 1;
    if (beaten > loadGauntletBest()) saveGauntletBest(beaten);
    if (won && level.id === 5) {
      title = 'Gauntlet complete: all 5 bots beaten!';
      retryLabel = 'Run it again (Enter)';
    } else if (won) {
      title = `Bot ${level.id} of 5 beaten!`;
      retryLabel = `Next: ${LEVELS[(level.id + 1) as LevelId].name} bot (Enter)`;
    } else {
      title = `Gauntlet over at bot ${level.id} of 5 (${level.name})`;
      retryLabel = 'Start over (Enter)';
    }
  }
  $('result-title').textContent = title;
  $('result-time').textContent = `${score[0]} – ${score[1]}`;
  $('result-detail').textContent = `Last round: you sent ${a.attackSent} lines, the bot sent ${b.attackSent}`;
  $('retry').textContent = retryLabel;
  show('result');
}

// ---- online ---------------------------------------------------------------

function lobby(title: string, detail = '', code: string | null = null, cancel = 'Cancel (Esc)'): void {
  $('lobby-title').textContent = title;
  $('lobby-detail').textContent = detail;
  $('lobby-code').textContent = code ?? '';
  $('lobby-code').classList.toggle('hidden', !code);
  $('lobby-cancel').textContent = cancel;
  show('lobby');
}

function startOnline(how: JoinKind): void {
  leaveOnline();
  setMode('online');
  match = null;
  bot = null;
  gauntlet = false;
  lastReplay = null;
  const name = $<HTMLInputElement>('player-name').value.trim();
  saveName(name);
  lobby('Connecting…', how.kind === 'quick' ? 'Looking for an opponent.' : '');
  const m = new OnlineMatch({
    phase: (p) => onOnlinePhase(m, p),
    gameEvents: (side, events) => {
      const now = performance.now();
      for (const ev of events) {
        if (ev.type === 'clear') popups[side] = { lines: describeClear(ev.info), at: now };
        else if (ev.type === 'attack') {
          popups[side]?.lines.push(ev.info.sent > 0 ? `+${ev.info.sent} SENT` : 'BLOCKED');
          characters[1 - side].addHit(ev.info.raw, ev.info.sent === 0, now);
        }
      }
    },
    error: (message) => {
      if (online === m) lobby('Not connected', message, null, 'Back (Esc)');
    },
  });
  online = m;
  void m.join(how, name, { ...handling });
}

function leaveOnline(): void {
  online?.leave();
  online = null;
}

function onOnlinePhase(m: OnlineMatch, phase: OnlinePhase): void {
  if (online !== m) return;
  const now = performance.now();
  if (phase === 'waiting') {
    if (m.code) lobby('Room created', 'Send this code to a friend. The match starts when they join.', m.code);
    else lobby('Looking for an opponent…', 'Quick match pairs you with the next player who joins.');
  } else if (phase === 'countdown') {
    for (const k of allKeyboards) k.clearPending();
    popups = [null, null];
    banner = null;
    for (const c of characters) c.reset();
    show('countdown');
  } else if (phase === 'playing') {
    for (const k of allKeyboards) k.clearPending();
    pendingOnlineStart = soloKeys.heldEvents();
    show('playing');
  } else if (phase === 'roundEnd' || phase === 'matchEnd') {
    const youWon = m.lastWinner === 'you';
    if (m.lastWinner) characters[youWon ? 1 : 0].knockOut(now);
    const match = phase === 'matchEnd';
    banner = youWon ? (match ? 'YOU WIN!' : 'YOU TAKE THE ROUND') : match ? `${m.names[1].toUpperCase()} WINS` : `${m.names[1].toUpperCase()} TAKES THE ROUND`;
    roundEndAt = now;
    show('roundEnd');
  }
}

function showOnlineResult(m: OnlineMatch): void {
  const youWon = m.lastWinner === 'you';
  $('result-title').textContent = youWon ? 'You win!' : `${m.names[1]} wins`;
  $('result-time').textContent = `${m.score[0]} – ${m.score[1]}`;
  $('retry').textContent = 'Rematch (Enter)';
  banner = null;
  refreshOnlineResult(m);
  show('result');
}

/** The result text under the score, kept up to date with rematch requests. */
function refreshOnlineResult(m: OnlineMatch): void {
  const why = m.endReason ? describeEnd(m.endReason, m.lastWinner === 'you') : '';
  const gone = !m.room || !m.opponentConnected;
  const [mine, theirs] = m.rematch;
  const rematch = gone ? (m.endReason === 'left' ? '' : 'Your opponent has gone.') : mine ? 'Waiting for your opponent to accept…' : theirs ? `${m.names[1]} wants a rematch!` : '';
  $('result-detail').textContent = [why, rematch].filter(Boolean).join(' ');
  $<HTMLButtonElement>('retry').disabled = gone || mine;
}

function onlineStatus(m: OnlineMatch): string | null {
  if (!m.connected) return 'Connection lost, reconnecting…';
  if (!m.opponentConnected && m.phase !== 'matchEnd') return `${m.names[1]} lost connection, waiting for them…`;
  if (m.phase === 'playing' && m.local?.game.over) return 'Waiting for the server…';
  return null;
}

function drawOnline(m: OnlineMatch, now: number): void {
  const games = m.games;
  let countdown: string | null = null;
  if (m.phase === 'countdown') {
    const left = m.playStart - now;
    const step = COUNTDOWN.length - Math.ceil(left / COUNTDOWN_STEP_MS);
    countdown = COUNTDOWN[Math.max(0, Math.min(COUNTDOWN.length - 1, step))];
  }
  // Nothing to show behind the lobby yet.
  renderer.setLayout(games ? 'versus' : 'solo');
  if (!games) return renderer.draw(null, { goalLines: SPRINT_LINES, countdown: null, popup: null });
  renderer.drawVersus({ players: games }, {
    countdown,
    popups,
    characters,
    score: m.score,
    roundsToWin: m.roundsToWin,
    banner,
    names: [m.names[0].toUpperCase(), m.names[1].toUpperCase()],
    status: onlineStatus(m),
  });
}

// ---- simulation -----------------------------------------------------------

function stepSprint(): void {
  if (!game || !recorder) return;
  const events = [...pendingStart, ...soloKeys.take()];
  pendingStart = [];
  for (const e of events) recorder.record(game.tick, e.key, e.down);
  game.step(events);
  for (const ev of game.drainEvents()) {
    if (ev.type === 'clear') popup = { lines: describeClear(ev.info), at: performance.now() };
  }
  if (game.over) endSprint();
}

function stepVersus(): void {
  if (!match || !matchRecorder) return;
  const human = mode === 'bot' ? soloKeys : versusKeys[0];
  const second = mode === 'bot' && bot ? bot.update(match.players[1]) : versusKeys[1].take();
  const inputs: [KeyEvent[], KeyEvent[]] = [
    [...pendingVersusStart[0], ...human.take()],
    [...pendingVersusStart[1], ...second],
  ];
  pendingVersusStart = [[], []];
  for (const p of [0, 1] as const) for (const e of inputs[p]) matchRecorder.record(p, match.tick, e);
  match.step(inputs);
  const now = performance.now();
  match.drainEvents().forEach((events, p) => {
    for (const ev of events) {
      if (ev.type === 'clear') {
        popups[p] = { lines: describeClear(ev.info), at: now };
      } else if (ev.type === 'attack') {
        const { raw, sent } = ev.info;
        popups[p]?.lines.push(sent > 0 ? `+${sent} SENT` : 'BLOCKED');
        // The object matches the full attack, so a big combo always looks big.
        characters[1 - p].addHit(raw, sent === 0, now);
      }
    }
  });
  if (match.over) endRound();
}

const LINE_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'];

function describeClear(info: ClearInfo): string[] {
  const out: string[] = [];
  const spin = info.spin === 'full' ? 'T-SPIN' : info.spin === 'mini' ? 'T-SPIN MINI' : '';
  const name = [spin, LINE_NAMES[info.lines]].filter(Boolean).join(' ');
  out.push(name);
  if (info.b2b > 0) out.push(`BACK-TO-BACK ×${info.b2b}`);
  if (info.combo > 0) out.push(`${info.combo} COMBO`);
  if (info.perfectClear) out.push('PERFECT CLEAR');
  return out;
}

function frame(now: number): void {
  const elapsed = now - lastFrame;
  lastFrame = now;
  if (mode === 'online' && online) {
    const m = online;
    m.update(now, () => {
      const events = [...pendingOnlineStart, ...soloKeys.take()];
      pendingOnlineStart = [];
      return events;
    });
    // The server starts the next round; only the end of the match needs a screen.
    if (screen === 'roundEnd' && m.phase === 'matchEnd' && now - roundEndAt >= ROUND_END_MS) showOnlineResult(m);
    if (screen === 'result') refreshOnlineResult(m);
    drawOnline(m, now);
    requestAnimationFrame(frame);
    return;
  }
  let countdown: string | null = null;

  if (screen === 'countdown') {
    const step = Math.floor((now - countdownStart) / COUNTDOWN_STEP_MS);
    if (step >= COUNTDOWN.length) beginPlay();
    else countdown = COUNTDOWN[step];
  }
  if (screen === 'playing') {
    accumulator += elapsed;
    let n = 0;
    while (accumulator >= TICK_MS && n < MAX_CATCH_UP && screen === 'playing') {
      if (mode === 'sprint') stepSprint();
      else stepVersus();
      accumulator -= TICK_MS;
      n++;
    }
    if (n === MAX_CATCH_UP) accumulator = 0;
  }
  if (screen === 'roundEnd' && now - roundEndAt >= ROUND_END_MS) {
    if (Math.max(...score) >= ROUNDS_TO_WIN) showMatchResult();
    else startRound();
  }

  if (mode !== 'sprint' && match) {
    renderer.drawVersus(match, { countdown, popups, characters, score, roundsToWin: ROUNDS_TO_WIN, banner, names: playerNames() });
  } else {
    renderer.draw(mode === 'sprint' ? game : null, { goalLines: SPRINT_LINES, countdown, popup });
  }
  requestAnimationFrame(frame);
}

// ---- input ----------------------------------------------------------------

const inGame = () => screen === 'playing' || screen === 'countdown' || screen === 'roundEnd';

addEventListener('keydown', (e) => {
  // Typing a name or a room code: only Enter and Esc mean anything there.
  if (e.target instanceof HTMLInputElement) {
    if (e.code === 'Enter' && e.target.id === 'room-code') joinByCode();
    if (e.code === 'Escape') e.target.blur();
    return;
  }
  // R restarts a sprint only: in versus it sits next to the left player's keys.
  if (e.code === 'KeyR' && mode === 'sprint' && (inGame() || screen === 'result')) {
    e.preventDefault();
    return startSprint();
  }
  if (e.code === 'Escape') {
    e.preventDefault();
    if (screen === 'settings') return closeSettings();
    if (mode === 'online') leaveOnline();
    if (screen !== 'menu') return show('menu');
  }
  if (e.code === 'Enter' && screen === 'menu') return startSprint();
  if (e.code === 'Enter' && screen === 'result') return retry();
  const keyboards = mode === 'versus' ? versusKeys : [soloKeys];
  let claimed = false;
  for (const k of keyboards) claimed = k.keyDown(e.code) || claimed;
  if (claimed && inGame()) e.preventDefault();
});
addEventListener('keyup', (e) => {
  let claimed = false;
  for (const k of allKeyboards) claimed = k.keyUp(e.code) || claimed;
  if (claimed && screen === 'playing') e.preventDefault();
});
addEventListener('blur', () => allKeyboards.forEach((k) => k.releaseAll()));

// ---- menu and settings ----------------------------------------------------

$('start').addEventListener('click', startSprint);
$('start-versus').addEventListener('click', startVersus);
$('start-bot').addEventListener('click', () => startBotMatch(botLevel, false));
$('start-gauntlet').addEventListener('click', () => startBotMatch(1, true));
const levelButtons = $('bot-levels');
for (const id of LEVEL_IDS) {
  const b = document.createElement('button');
  b.dataset.level = String(id);
  b.textContent = `${id} ${LEVELS[id].name}`;
  b.title = `${LEVELS[id].pps} pieces per second`;
  b.addEventListener('click', () => {
    botLevel = id;
    saveBotLevel(id);
    refreshBotMenu();
  });
  levelButtons.append(b);
}
$('retry').addEventListener('click', retry);
$('to-menu').addEventListener('click', () => {
  if (mode === 'online') leaveOnline();
  show('menu');
});
$('online-quick').addEventListener('click', () => startOnline({ kind: 'quick' }));
$('online-create').addEventListener('click', () => startOnline({ kind: 'create' }));
$('online-join').addEventListener('click', joinByCode);
$('lobby-cancel').addEventListener('click', () => {
  leaveOnline();
  show('menu');
});
$<HTMLInputElement>('player-name').value = loadName();

function joinByCode(): void {
  const code = $<HTMLInputElement>('room-code').value.trim().toUpperCase();
  if (code.length !== 5) return void $('room-code').focus();
  startOnline({ kind: 'join', code });
}
$('open-settings').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', closeSettings);
$('reset-settings').addEventListener('click', () => {
  handling = { ...DEFAULT_HANDLING };
  syncSettingsForm();
});
$('download-replay').addEventListener('click', () => {
  if (!lastReplay) return;
  const blob = new Blob([JSON.stringify(lastReplay)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `line-battle-${mode}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

const sliders = { das: $<HTMLInputElement>('das'), arr: $<HTMLInputElement>('arr'), sdf: $<HTMLInputElement>('sdf') };

function framesLabel(frames: number): string {
  return `${frames} frames (${Math.round((frames * 1000) / TICK_RATE)} ms)`;
}

function syncSettingsForm(): void {
  sliders.das.value = String(handling.das);
  sliders.arr.value = String(handling.arr);
  sliders.sdf.value = String(handling.sdf);
  $('das-out').textContent = framesLabel(handling.das);
  $('arr-out').textContent = handling.arr === 0 ? '0 (instant)' : framesLabel(handling.arr);
  $('sdf-out').textContent = handling.sdf >= SDF_INSTANT ? 'instant' : `${handling.sdf}×`;
}

for (const [name, input] of Object.entries(sliders) as [keyof typeof sliders, HTMLInputElement][]) {
  input.addEventListener('input', () => {
    handling = { ...handling, [name]: Number(input.value) };
    syncSettingsForm();
  });
}

function openSettings(): void {
  syncSettingsForm();
  show('settings');
}

function closeSettings(): void {
  saveHandling(handling);
  show('menu');
}

show('menu');
requestAnimationFrame(frame);

// Dev builds only: a handle for poking at the game from the browser console.
if (import.meta.env.DEV) {
  Object.assign(window, { lineBattle: { get match() { return match; }, get bot() { return bot; }, get online() { return online; }, characters } });
}
