import {
  CHARACTER_NAMES,
  CHARACTERS,
  DEFAULT_HANDLING,
  DEFAULT_KEYS,
  EARNED_SKINS,
  Game,
  KEYS,
  Match,
  MatchRecorder,
  randomSeed,
  Recorder,
  SDF_INSTANT,
  TICK_RATE,
  MAX_KEYS_PER_ACTION,
  sanitizeKeys,
  SKIN_NAMES,
  SKINS,
  THEME_NAMES,
  THEMES,
  type CharacterId,
  type ClearInfo,
  type GameEvent,
  type Key,
  type GameConfig,
  type KeyEvent,
  type Look,
  type MatchConfig,
  type MatchReplay,
  type MatchSummary,
  type Region,
  REGION_NAMES,
  REGIONS,
  type Replay,
  type SkinId,
} from '@line-battle/engine';
import { Account, ApiError } from './account';
import { BOT_HANDLING, BotController, LEVEL_IDS, LEVELS, type LevelId } from '@line-battle/bot';
import { BotWorker } from './bot-client';
import { characterUrl, preloadArt } from './art';
import { CharacterView, fallMs, objectFor } from './character';
import { ACTION_NAMES, bindingsFrom, Keyboard, keyLabel, keysText, P1_BINDINGS, P2_BINDINGS, RESERVED_CODES } from './input';
import { describeEnd, OnlineMatch, type JoinKind, type OnlinePhase } from './online';
import { formatTime, Renderer, type Popup } from './render';
import { drawCell, skinSheet, THEME_COLORS } from './skins';
import { Sound } from './sound';
import { Tutorial } from './tutorial';
import {
  loadBestTicks,
  loadBotLevel,
  loadGauntletBest,
  loadHandling,
  loadName,
  loadPrefs,
  loadRegion,
  saveBestTicks,
  saveBotLevel,
  saveGauntletBest,
  saveHandling,
  saveName,
  savePrefs,
  saveRegion,
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
type Mode = 'sprint' | 'versus' | 'bot' | 'online' | 'tutorial';
/** 'lobby' covers connecting, waiting for an opponent and connection errors. */
type Screen = 'menu' | 'settings' | 'customize' | 'controls' | 'account' | 'profile' | 'lobby' | 'countdown' | 'playing' | 'roundEnd' | 'result';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const renderer = new Renderer($<HTMLCanvasElement>('game'));
let prefs = loadPrefs();
const soloKeys = new Keyboard(bindingsFrom(prefs.keys));
const sound = new Sound();
sound.setVolume(prefs.volume);
preloadArt();
const versusKeys = [new Keyboard(P1_BINDINGS), new Keyboard(P2_BINDINGS)] as const;
const allKeyboards = [soloKeys, ...versusKeys];

let mode: Mode = 'sprint';
let screen: Screen = 'menu';
let handling = loadHandling();
let countdownStart = 0;
/** The countdown number last shown, so each one beeps once. */
let lastCountdownStep = -1;
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
const characters: [CharacterView, CharacterView] = [new CharacterView(prefs.look.character), new CharacterView('bolt')];
let pendingVersusStart: [KeyEvent[], KeyEvent[]] = [[], []];
let banner: string | null = null;
let roundEndAt = 0;

// Bot state
const botWorker = new BotWorker();
let botLevel: LevelId = loadBotLevel();
let bot: BotController | null = null;
/** Set during a gauntlet run; the bot's level is the current stage. */
let gauntlet = false;

// Tutorial state
let tutorial: Tutorial | null = null;

// Online state
let online: OnlineMatch | null = null;
let pendingOnlineStart: KeyEvent[] = [];
const account = new Account();
let region: Region = loadRegion();

// ---- screens --------------------------------------------------------------

function show(next: Screen): void {
  screen = next;
  $('menu').classList.toggle('hidden', next !== 'menu');
  $('settings').classList.toggle('hidden', next !== 'settings');
  $('customize').classList.toggle('hidden', next !== 'customize');
  $('controls').classList.toggle('hidden', next !== 'controls');
  $('tutorial-tip').classList.toggle('hidden', mode !== 'tutorial' || !inGameScreen(next));
  $('result').classList.toggle('hidden', next !== 'result');
  $('lobby').classList.toggle('hidden', next !== 'lobby');
  $('account').classList.toggle('hidden', next !== 'account');
  $('profile').classList.toggle('hidden', next !== 'profile');
  $('download-replay').classList.toggle('hidden', mode === 'online' ? !online?.matchId : !lastReplay);
  if (mode !== 'online') $('result-rating').classList.add('hidden');
  if (mode !== 'online') $<HTMLButtonElement>('retry').disabled = false;
  if (next === 'menu') {
    refreshBest();
    refreshControlsTable();
    // New players see the tutorial first.
    $('start-tutorial').classList.toggle('primary', !prefs.tutorialDone);
  }
}

function inGameScreen(s: Screen): boolean {
  return s === 'playing' || s === 'countdown' || s === 'roundEnd';
}

function refreshBest(): void {
  const best = loadBestTicks();
  $('best').textContent = best ? formatTime(best) : 'none yet';
  refreshBotMenu();
}

function setMode(next: Mode): void {
  mode = next;
  renderer.setLayout(next === 'sprint' || next === 'tutorial' ? 'solo' : 'versus');
  applyLooks();
}

/** A skin you can use: earned skins need to be earned first. */
function skinAllowed(skin: SkinId): boolean {
  return skin !== 'gold' || loadGauntletBest() >= 5;
}

/** Your look, with any skin you haven't earned (e.g. set on another device) swapped for the default. */
function myLook(): Look {
  return { character: prefs.look.character, skin: skinAllowed(prefs.look.skin) ? prefs.look.skin : 'gem' };
}

/** A character for the other side that isn't yours. */
function otherCharacter(preferred: CharacterId): CharacterId {
  return preferred !== prefs.look.character ? preferred : CHARACTERS.find((c) => c !== preferred)!;
}

/** Characters, skins and theme for the current mode. */
function applyLooks(): void {
  const mine = myLook();
  let theirs: Look;
  if (mode === 'online' && online) theirs = online.looks[1];
  else if (mode === 'bot') theirs = { character: otherCharacter('bolt'), skin: 'gem' };
  else theirs = { character: otherCharacter('pip'), skin: 'gem' };
  characters[0].character = mine.character;
  characters[1].character = theirs.character;
  renderer.setSkins([skinSheet(mine.skin), skinSheet(prefs.plainOpponent ? 'gem' : theirs.skin)]);
  const theme = THEME_COLORS[prefs.theme];
  renderer.setTheme(theme);
  document.body.style.backgroundColor = theme.page;
}

/** Saves prefs here and, when signed in, on the account. */
function storePrefs(): void {
  savePrefs(prefs);
  void account.saveSettings({ prefs });
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
  lastCountdownStep = -1;
  show('countdown');
}

function startTutorial(): void {
  setMode('tutorial');
  tutorial = new Tutorial();
  game = tutorial.game;
  recorder = null;
  popup = null;
  refreshTutorialTip();
  startCountdown();
}

function refreshTutorialTip(done = false): void {
  if (!tutorial) return;
  $('tutorial-step').textContent = tutorial.finished ? 'All done' : `Step ${tutorial.lesson + 1} of ${tutorial.count}`;
  $('tutorial-title').textContent = tutorial.title();
  $('tutorial-text').textContent = tutorial.text(prefs.keys);
  $('tutorial-end').classList.toggle('hidden', !tutorial.finished);
  $('tutorial-skip').classList.toggle('hidden', tutorial.finished);
  const tip = $('tutorial-tip');
  if (done) {
    tip.classList.remove('done');
    void tip.offsetWidth;
    tip.classList.add('done');
  }
}

function finishTutorial(): void {
  if (!prefs.tutorialDone) {
    prefs = { ...prefs, tutorialDone: true };
    storePrefs();
  }
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
  if (mode === 'online') return online && !online.canRematch ? startOnline({ kind: 'ranked' }) : online?.askRematch();
  if (mode === 'sprint') return startSprint();
  if (mode === 'tutorial') return startTutorial();
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
  if (result !== null && result !== 'draw') characters[result].celebrate(now);
  sound.topOut();
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
  sound.win();
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
  if (won) sound.win();
  else sound.lose();
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
  const guestName = $<HTMLInputElement>('player-name').value.trim();
  saveName(guestName);
  lobby('Connecting…');
  const m = new OnlineMatch({
    phase: (p) => onOnlinePhase(m, p),
    gameEvents: (side, events) => {
      const now = performance.now();
      for (const ev of events) {
        if (ev.type === 'clear') popups[side] = { lines: describeClear(ev.info), at: now };
        else if (ev.type === 'attack') {
          popups[side]?.lines.push(ev.info.sent > 0 ? `+${ev.info.sent} SENT` : 'BLOCKED');
          hitCharacter(1 - side, ev.info.raw, ev.info.sent === 0, now);
        }
        if (side === 0) playEventSound(ev);
      }
    },
    error: (message) => {
      if (online === m) lobby('Not connected', message, null, 'Back (Esc)');
    },
  });
  online = m;
  void m.join(how, { name: account.me?.name ?? guestName, handling: { ...handling }, look: myLook(), region, token: account.token });
}

/** The lobby text while the queue searches. */
function queueText(m: OnlineMatch): string {
  const s = m.search;
  if (!s) return '';
  const secs = Math.floor(s.waitedMs / 1000);
  const where = s.anyRegion ? 'any region' : REGION_NAMES[s.region];
  const others = s.inQueue > 1 ? `${s.inQueue - 1} other ${s.inQueue === 2 ? 'player' : 'players'} searching` : 'nobody else searching yet';
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} · rating ${s.rating} ± ${s.range} · ${where} · ${others}`;
}

function leaveOnline(): void {
  online?.leave();
  online = null;
}

function onOnlinePhase(m: OnlineMatch, phase: OnlinePhase): void {
  if (online !== m) return;
  const now = performance.now();
  if (phase === 'queued') {
    lobby(m.queueKind === 'ranked' ? 'Looking for a ranked opponent…' : 'Looking for an opponent…', queueText(m));
  } else if (phase === 'waiting') {
    if (m.code) lobby('Room created', 'Send this code to a friend. The match starts when they join.', m.code);
    else lobby('Looking for an opponent…', 'Quick match pairs you with the next player who joins.');
  } else if (phase === 'countdown') {
    for (const k of allKeyboards) k.clearPending();
    applyLooks();
    lastCountdownStep = -1;
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
    if (m.lastWinner) {
      characters[youWon ? 1 : 0].knockOut(now);
      characters[youWon ? 0 : 1].celebrate(now);
      sound.topOut();
    }
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
  $('retry').textContent = m.canRematch ? 'Rematch (Enter)' : 'Play ranked again (Enter)';
  banner = null;
  refreshOnlineResult(m);
  if (youWon) sound.win();
  else sound.lose();
  show('result');
  // The account bar shows the new rating.
  if (m.mode === 'ranked') void account.refresh();
}

/** The result text under the score, kept up to date with rematch requests. */
function refreshOnlineResult(m: OnlineMatch): void {
  const why = m.endReason ? describeEnd(m.endReason, m.lastWinner === 'you') : '';
  $('download-replay').classList.toggle('hidden', !m.matchId);
  const change = m.ratingChange;
  const rating = $('result-rating');
  rating.classList.toggle('hidden', !change);
  if (change) {
    const diff = change.after.rating - change.before.rating;
    const key = `${change.before.rating}>${change.after.rating}`;
    if (rating.dataset.key !== key) {
      rating.dataset.key = key;
      rating.innerHTML = '';
      const delta = document.createElement('span');
      delta.className = diff >= 0 ? 'up' : 'down';
      delta.textContent = ` (${diff >= 0 ? '+' : ''}${diff})`;
      rating.append(`Rating ${change.before.rating} → ${change.after.rating}`, delta);
    }
  }
  if (!m.canRematch) {
    // Ranked: no rematch, just a fresh search.
    $('result-detail').textContent = why;
    $<HTMLButtonElement>('retry').disabled = false;
    return;
  }
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
    beepCountdown(Math.max(0, step));
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
    names: [0, 1].map((i) => m.names[i].toUpperCase() + (m.ratings ? ` · ${m.ratings[i].rating}` : '')) as [string, string],
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
    playEventSound(ev);
  }
  if (game.over) endSprint();
}

function stepTutorial(): void {
  if (!game || !tutorial) return;
  const events = [...pendingStart, ...soloKeys.take()];
  pendingStart = [];
  game.step(events);
  const out = game.drainEvents();
  for (const ev of out) {
    if (ev.type === 'clear') popup = { lines: describeClear(ev.info), at: performance.now() };
    playEventSound(ev);
  }
  const result = tutorial.update(events.filter((e) => e.down).map((e) => e.key), out);
  if (result === 'done') {
    sound.win();
    refreshTutorialTip(true);
    if (tutorial.finished) finishTutorial();
  } else if (result === 'retry') {
    popup = { lines: ['TRY AGAIN', 'the gap got covered'], at: performance.now() };
  }
  // Topping out just starts the same lesson again on a fresh board.
  if (game.over) {
    const lesson = tutorial.lesson;
    tutorial = new Tutorial(lesson);
    game = tutorial.game;
    refreshTutorialTip();
  }
}

/** Sounds for your own board's events. */
function playEventSound(ev: GameEvent): void {
  if (ev.type === 'lock') sound.lock();
  else if (ev.type === 'clear') sound.clear(ev.info);
  else if (ev.type === 'hold') sound.hold();
  else if (ev.type === 'garbage') sound.garbage(ev.lines);
}

/** An attack lands on `side`'s character, with its sound when the object hits. */
function hitCharacter(side: number, raw: number, blocked: boolean, now: number): void {
  if (raw <= 0) return;
  characters[side].addHit(raw, blocked, now);
  const object = objectFor(raw);
  // In a bot or online match side 0 is you; the hit on you is the louder one.
  sound.impact(object, blocked, fallMs(object) / 1000, mode === 'versus' || side === 0);
}

function beepCountdown(step: number): void {
  if (step === lastCountdownStep) return;
  lastCountdownStep = step;
  sound.countdown(false);
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
      if (p === 0 || mode === 'versus') playEventSound(ev);
      if (ev.type === 'clear') {
        popups[p] = { lines: describeClear(ev.info), at: now };
      } else if (ev.type === 'attack') {
        const { raw, sent } = ev.info;
        popups[p]?.lines.push(sent > 0 ? `+${sent} SENT` : 'BLOCKED');
        // The object matches the full attack, so a big combo always looks big.
        hitCharacter(1 - p, raw, sent === 0, now);
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
    if (screen === 'lobby' && m.phase === 'queued') $('lobby-detail').textContent = queueText(m);
    drawOnline(m, now);
    requestAnimationFrame(frame);
    return;
  }
  let countdown: string | null = null;

  if (screen === 'countdown') {
    const step = Math.floor((now - countdownStart) / COUNTDOWN_STEP_MS);
    if (step >= COUNTDOWN.length) {
      sound.countdown(true);
      beginPlay();
    } else {
      countdown = COUNTDOWN[step];
      beepCountdown(step);
    }
  }
  if (screen === 'playing') {
    accumulator += elapsed;
    let n = 0;
    while (accumulator >= TICK_MS && n < MAX_CATCH_UP && screen === 'playing') {
      if (mode === 'sprint') stepSprint();
      else if (mode === 'tutorial') stepTutorial();
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

  if ((mode === 'bot' || mode === 'versus') && match) {
    renderer.drawVersus(match, { countdown, popups, characters, score, roundsToWin: ROUNDS_TO_WIN, banner, names: playerNames() });
  } else {
    const solo = mode === 'sprint' || mode === 'tutorial';
    renderer.draw(solo ? game : null, { goalLines: mode === 'tutorial' ? 0 : SPRINT_LINES, countdown, popup });
  }
  requestAnimationFrame(frame);
}

// ---- input ----------------------------------------------------------------

const inGame = () => screen === 'playing' || screen === 'countdown' || screen === 'roundEnd';

addEventListener('keydown', (e) => {
  sound.unlock();
  if (screen === 'controls' && listening) return void bindKey(e);
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
    if (screen === 'customize') return closeCustomize();
    if (screen === 'controls') return closeControls();
    if (mode === 'tutorial' && tutorial && !tutorial.finished) finishTutorial();
    if (screen === 'account' || screen === 'profile') return show('menu');
    if (mode === 'online') leaveOnline();
    if (screen !== 'menu') return show('menu');
  }
  if (e.code === 'Enter' && screen === 'menu') return startSprint();
  if (e.code === 'Enter' && screen === 'result') return retry();
  const keyboards = mode === 'versus' ? versusKeys : [soloKeys];
  let claimed = false;
  for (const k of keyboards) {
    // Move and rotate clicks; the engine reports locks, clears and holds itself.
    const action = k.actionFor(e.code);
    if (action && !e.repeat && screen === 'playing') {
      if (action === 'left' || action === 'right') sound.move();
      else if (action.startsWith('rotate')) sound.rotate();
    }
    claimed = k.keyDown(e.code) || claimed;
  }
  if (claimed && inGame()) e.preventDefault();
});
addEventListener('pointerdown', () => sound.unlock());
addEventListener('keyup', (e) => {
  let claimed = false;
  for (const k of allKeyboards) claimed = k.keyUp(e.code) || claimed;
  if (claimed && screen === 'playing') e.preventDefault();
});
addEventListener('blur', () => allKeyboards.forEach((k) => k.releaseAll()));

// ---- menu and settings ----------------------------------------------------

$('start').addEventListener('click', startSprint);
$('start-tutorial').addEventListener('click', startTutorial);
$('tutorial-skip').addEventListener('click', () => {
  finishTutorial();
  show('menu');
});
$('tutorial-menu').addEventListener('click', () => show('menu'));
$('tutorial-bot').addEventListener('click', () => {
  botLevel = 1;
  saveBotLevel(1);
  startBotMatch(1, false);
});
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
$('online-ranked').addEventListener('click', () => {
  if (!account.signedIn) return openAccount('Log in or create an account to play ranked.');
  startOnline({ kind: 'ranked' });
});
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
function download(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Online replays live on the server; fetch one and save it. */
async function downloadOnlineReplay(matchId: number): Promise<void> {
  try {
    download(await account.replay(matchId), `line-battle-online-${matchId}.json`);
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
  }
}

$('download-replay').addEventListener('click', () => {
  if (mode === 'online') {
    if (online?.matchId) void downloadOnlineReplay(online.matchId);
    return;
  }
  if (lastReplay) download(lastReplay, `line-battle-${mode}-${Date.now()}.json`);
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
  void account.saveSettings({ handling });
  show('menu');
}

// ---- accounts and profiles ------------------------------------------------

const regionSelect = $<HTMLSelectElement>('region');
for (const r of REGIONS) regionSelect.append(new Option(REGION_NAMES[r], r));

function setRegion(next: Region): void {
  region = next;
  regionSelect.value = next;
  saveRegion(next);
}
setRegion(region);
regionSelect.addEventListener('change', () => {
  setRegion(regionSelect.value as Region);
  void account.saveSettings({ region });
});

function refreshAccountBar(): void {
  const me = account.me;
  const status = $('account-status');
  status.textContent = '';
  if (me) {
    const strong = document.createElement('strong');
    strong.textContent = me.name;
    const r = me.rating;
    status.append('Signed in as ', strong, ` · rating ${r.rating}${r.settled ? '' : ` ± ${r.rd}`}`);
  } else {
    status.textContent = 'Playing as a guest';
  }
  $('open-account').classList.toggle('hidden', !!me);
  $('open-profile').classList.toggle('hidden', !me);
  $('log-out').classList.toggle('hidden', !me);
  // Signed in, your account name is used online.
  $('player-name').classList.toggle('hidden', !!me);
}

account.onChange(refreshAccountBar);

/** After signing in, the account's settings win over this browser's. */
function adoptAccountSettings(): void {
  const me = account.me;
  if (!me) return;
  if (me.handling) {
    handling = { ...me.handling };
    saveHandling(handling);
  }
  setRegion(me.region);
  if (me.prefs) setPrefs(me.prefs, false);
}

function openAccount(message = ''): void {
  $('account-error').textContent = message;
  show('account');
  $<HTMLInputElement>('account-name').focus();
}

async function submitAccount(kind: 'login' | 'signup'): Promise<void> {
  const name = $<HTMLInputElement>('account-name').value.trim();
  const password = $<HTMLInputElement>('account-password').value;
  const error = $('account-error');
  const buttons = [$<HTMLButtonElement>('log-in'), $<HTMLButtonElement>('sign-up')];
  if (!name || !password) return void (error.textContent = 'Enter a name and a password.');
  buttons.forEach((b) => (b.disabled = true));
  error.textContent = '';
  try {
    if (kind === 'signup') await account.signUp(name, password, region, handling, prefs);
    else await account.logIn(name, password);
    adoptAccountSettings();
    $<HTMLInputElement>('account-password').value = '';
    show('menu');
  } catch (e) {
    error.textContent = e instanceof ApiError ? e.message : 'Something went wrong. Try again.';
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

$('open-account').addEventListener('click', () => openAccount());
$('close-account').addEventListener('click', () => show('menu'));
$('account-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void submitAccount('login');
});
$('sign-up').addEventListener('click', () => void submitAccount('signup'));
$('log-out').addEventListener('click', () => void account.logOut());
$('open-profile').addEventListener('click', () => void openProfile());
$('close-profile').addEventListener('click', () => show('menu'));

function cell(row: HTMLTableRowElement, text: string, className = ''): HTMLTableCellElement {
  const td = row.insertCell();
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function matchRow(table: HTMLTableElement, m: MatchSummary): void {
  const row = table.insertRow();
  const won = m.winner === m.side;
  const opp = m.names[1 - m.side];
  cell(row, won ? 'Win' : m.winner === null ? 'Void' : 'Loss', won ? 'win' : 'loss');
  cell(row, `${m.score[m.side]}–${m.score[1 - m.side]}`);
  cell(row, `vs ${opp}`);
  cell(row, m.mode === 'ranked' ? 'Ranked' : m.mode === 'quick' ? 'Quick' : 'Room');
  const r = m.ratings?.[m.side];
  // A ranked match the server rejected inputs in doesn't count.
  cell(row, r ? `${r[1]} (${r[1] - r[0] >= 0 ? '+' : ''}${r[1] - r[0]})` : m.mode === 'ranked' ? 'not rated' : '');
  const replay = document.createElement('button');
  replay.textContent = 'Replay';
  replay.title = 'Download this match as a replay file';
  replay.addEventListener('click', () => void downloadOnlineReplay(m.id));
  row.insertCell().append(replay);
}

async function openProfile(): Promise<void> {
  const me = account.me;
  if (!me) return openAccount();
  $('profile-name').textContent = me.name;
  $('profile-rating').textContent = '…';
  $('profile-detail').textContent = '';
  const matches = $<HTMLTableElement>('profile-matches');
  const board = $<HTMLTableElement>('leaderboard');
  matches.innerHTML = '';
  board.innerHTML = '';
  show('profile');
  try {
    const [profile, leaders] = await Promise.all([account.profile(me.name), account.leaderboard()]);
    const r = profile.rating;
    $('profile-rating').textContent = r.settled ? String(r.rating) : `${r.rating} ± ${r.rd}`;
    const losses = profile.games - profile.wins;
    const place = profile.rank ? `#${profile.rank} on the leaderboard` : r.settled ? 'Not on the leaderboard yet' : 'Provisional rating: play more ranked matches to settle it';
    $('profile-detail').textContent = `${profile.games} ranked ${profile.games === 1 ? 'match' : 'matches'} · ${profile.wins} won, ${losses} lost · ${REGION_NAMES[profile.region]} · ${place}`;
    if (profile.recent.length === 0) cell(matches.insertRow(), 'No online matches yet.');
    for (const m of profile.recent) matchRow(matches, m);
    if (leaders.length === 0) cell(board.insertRow(), 'Nobody has a settled rating yet.');
    for (const e of leaders) {
      const row = board.insertRow();
      cell(row, `#${e.rank}`);
      cell(row, e.name, e.name === me.name ? 'win' : '');
      cell(row, String(e.rating));
      cell(row, REGION_NAMES[e.region]);
    }
  } catch (e) {
    $('profile-rating').textContent = '';
    $('profile-detail').textContent = e instanceof Error ? e.message : String(e);
  }
}

// ---- prefs: character and skins, controls ---------------------------------

/** Takes new prefs (from the account, or a reset); `store` saves them back too. */
function setPrefs(next: typeof prefs, store = true): void {
  prefs = next;
  soloKeys.setBindings(bindingsFrom(prefs.keys));
  sound.setVolume(prefs.volume);
  applyLooks();
  refreshControlsTable();
  if (store) storePrefs();
  else savePrefs(prefs);
}

/** The menu's table of your current keys. */
function refreshControlsTable(): void {
  const table = $<HTMLTableElement>('solo-controls');
  table.innerHTML = '';
  const head = table.insertRow();
  const th = document.createElement('th');
  th.colSpan = 2;
  th.textContent = 'Sprint, bots and online';
  head.append(th);
  const rows: [string, string][] = [
    ['Move', `${keysText(prefs.keys.left)} / ${keysText(prefs.keys.right)}`],
    ['Soft drop', keysText(prefs.keys.softDrop)],
    ['Hard drop', keysText(prefs.keys.hardDrop)],
    ['Rotate clockwise', keysText(prefs.keys.rotateCW)],
    ['Rotate counter-clockwise', keysText(prefs.keys.rotateCCW)],
    ['Rotate 180', keysText(prefs.keys.rotate180)],
    ['Hold', keysText(prefs.keys.hold)],
    ['Restart / menu', 'R / Esc'],
  ];
  for (const [name, keys] of rows) {
    const row = table.insertRow();
    cell(row, name);
    cell(row, keys);
  }
}

function openCustomize(): void {
  buildCustomize();
  show('customize');
}

function closeCustomize(): void {
  storePrefs();
  show('menu');
}

function pickButton(parent: HTMLElement, selected: boolean, onPick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.classList.toggle('selected', selected);
  b.addEventListener('click', () => {
    onPick();
    applyLooks();
    buildCustomize();
  });
  parent.append(b);
  return b;
}

function buildCustomize(): void {
  const chars = $('character-pick');
  chars.innerHTML = '';
  for (const id of CHARACTERS) {
    const b = pickButton(chars, prefs.look.character === id, () => (prefs = { ...prefs, look: { ...prefs.look, character: id } }));
    const img = document.createElement('img');
    img.src = characterUrl(id, prefs.look.character === id ? 'win' : 'idle');
    img.alt = '';
    b.append(img, CHARACTER_NAMES[id]);
  }

  const skins = $('skin-pick');
  skins.innerHTML = '';
  for (const id of SKINS) {
    const allowed = skinAllowed(id);
    const b = pickButton(skins, prefs.look.skin === id && allowed, () => (prefs = { ...prefs, look: { ...prefs.look, skin: id } }));
    b.disabled = !allowed;
    // A row of all 7 pieces' blocks plus garbage, so you can check they stay easy to tell apart.
    const preview = document.createElement('canvas');
    preview.width = 224;
    preview.height = 64;
    const c = preview.getContext('2d')!;
    for (let i = 1; i <= 7; i++) drawCell(c, skinSheet(id), i, (i - 1) * 32, 0, 32);
    b.append(preview, SKIN_NAMES[id]);
    const earned = EARNED_SKINS[id];
    if (earned) {
      const note = document.createElement('span');
      note.className = 'lock';
      note.textContent = allowed ? 'Earned' : `Locked: ${earned.toLowerCase()}`;
      b.append(note);
    }
  }

  const themes = $('theme-pick');
  themes.innerHTML = '';
  for (const id of THEMES) {
    const b = pickButton(themes, prefs.theme === id, () => (prefs = { ...prefs, theme: id }));
    b.textContent = THEME_NAMES[id];
  }

  $<HTMLInputElement>('plain-opponent').checked = prefs.plainOpponent;
  $<HTMLInputElement>('volume').value = String(prefs.volume);
  $('volume-out').textContent = prefs.volume === 0 ? 'off' : `${prefs.volume}%`;
}

$('open-customize').addEventListener('click', openCustomize);
$('close-customize').addEventListener('click', closeCustomize);
$<HTMLInputElement>('plain-opponent').addEventListener('change', (e) => {
  prefs = { ...prefs, plainOpponent: (e.target as HTMLInputElement).checked };
  applyLooks();
});
$<HTMLInputElement>('volume').addEventListener('input', (e) => {
  prefs = { ...prefs, volume: Number((e.target as HTMLInputElement).value) };
  sound.setVolume(prefs.volume);
  $('volume-out').textContent = prefs.volume === 0 ? 'off' : `${prefs.volume}%`;
});
// A sample of the sound at the new volume.
$<HTMLInputElement>('volume').addEventListener('change', () => sound.impact('apple', false, 0));

/** The action waiting for a key press on the controls screen. */
let listening: Key | null = null;

function openControls(): void {
  listening = null;
  buildKeymap();
  show('controls');
}

function closeControls(): void {
  listening = null;
  setPrefs({ ...prefs, keys: sanitizeKeys(prefs.keys) });
  show('menu');
}

function buildKeymap(): void {
  const table = $<HTMLTableElement>('keymap');
  table.innerHTML = '';
  for (const key of KEYS) {
    const row = table.insertRow();
    cell(row, ACTION_NAMES[key]);
    const td = row.insertCell();
    for (const code of prefs.keys[key]) {
      const b = document.createElement('button');
      b.className = 'key';
      b.textContent = keyLabel(code);
      b.title = 'Remove this key';
      b.addEventListener('click', () => {
        prefs = { ...prefs, keys: { ...prefs.keys, [key]: prefs.keys[key].filter((c) => c !== code) } };
        buildKeymap();
      });
      td.append(b);
    }
    if (prefs.keys[key].length < MAX_KEYS_PER_ACTION) {
      const add = document.createElement('button');
      add.textContent = listening === key ? 'Press a key…' : '+';
      add.classList.toggle('listening', listening === key);
      add.title = 'Add a key';
      add.addEventListener('click', () => {
        listening = listening === key ? null : key;
        buildKeymap();
      });
      td.append(add);
    }
  }
  const empty = KEYS.filter((k) => prefs.keys[k].length === 0);
  $('keymap-hint').textContent = empty.length
    ? `${empty.map((k) => ACTION_NAMES[k]).join(', ')} ${empty.length === 1 ? 'has' : 'have'} no key yet: ${empty.length === 1 ? 'it gets its' : 'they get their'} default back when you leave.`
    : 'Click + to add a key, or a key to remove it. Each action can have up to 3 keys. Esc, Enter, Tab and R are kept for the menus.';
}

/** A key pressed while the controls screen waits for one. */
function bindKey(e: KeyboardEvent): void {
  e.preventDefault();
  const key = listening!;
  listening = null;
  if (e.code === 'Escape' || RESERVED_CODES.has(e.code) || !e.code) return buildKeymap();
  // A key does one thing: take it off whatever had it before.
  const keys = { ...prefs.keys };
  for (const k of KEYS) keys[k] = keys[k].filter((c) => c !== e.code);
  keys[key] = [...keys[key], e.code].slice(0, MAX_KEYS_PER_ACTION);
  prefs = { ...prefs, keys };
  buildKeymap();
}

$('open-controls').addEventListener('click', openControls);
$('close-controls').addEventListener('click', closeControls);
$('reset-keys').addEventListener('click', () => {
  prefs = { ...prefs, keys: DEFAULT_KEYS };
  listening = null;
  buildKeymap();
});

void account.restore().then(adoptAccountSettings);
refreshAccountBar();

show('menu');
requestAnimationFrame(frame);

// Dev builds only: a handle for poking at the game from the browser console.
if (import.meta.env.DEV) {
  Object.assign(window, { lineBattle: { get match() { return match; }, get bot() { return bot; }, get online() { return online; }, characters } });
}
