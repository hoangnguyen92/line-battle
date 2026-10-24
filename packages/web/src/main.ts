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
import { CharacterView } from './character';
import { Keyboard, P1_BINDINGS, P2_BINDINGS, SOLO_BINDINGS } from './input';
import { formatTime, PLAYER_COLORS, Renderer, type Popup } from './render';
import { loadBestTicks, loadHandling, saveBestTicks, saveHandling } from './settings';

const SPRINT_LINES = 40;
const ROUNDS_TO_WIN = 2;
/** How long the end of a round stays on screen before the next one starts. */
const ROUND_END_MS = 2600;
const TICK_MS = 1000 / TICK_RATE;
const COUNTDOWN_STEP_MS = 500;
const COUNTDOWN = ['3', '2', '1'];
/** Never simulate more than this many ticks per frame (e.g. after a tab switch). */
const MAX_CATCH_UP = 8;

type Mode = 'sprint' | 'versus';
type Screen = 'menu' | 'settings' | 'countdown' | 'playing' | 'roundEnd' | 'result';

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

// ---- screens --------------------------------------------------------------

function show(next: Screen): void {
  screen = next;
  $('menu').classList.toggle('hidden', next !== 'menu');
  $('settings').classList.toggle('hidden', next !== 'settings');
  $('result').classList.toggle('hidden', next !== 'result');
  if (next === 'menu') refreshBest();
}

function refreshBest(): void {
  const best = loadBestTicks();
  $('best').textContent = best ? formatTime(best) : 'none yet';
}

function setMode(next: Mode): void {
  mode = next;
  renderer.setLayout(next === 'sprint' ? 'solo' : 'versus');
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
  score = [0, 0];
  startRound();
}

function startRound(): void {
  // Both players get the same pieces; a fresh seed each round.
  const config: MatchConfig = { seed: randomSeed(), players: [{ handling: { ...handling } }, { handling: { ...handling } }] };
  match = new Match(config);
  matchRecorder = new MatchRecorder(config);
  popups = [null, null];
  banner = null;
  for (const c of characters) c.reset();
  startCountdown();
}

function retry(): void {
  if (mode === 'sprint') startSprint();
  else startVersus();
}

function beginPlay(): void {
  // Keys held through the countdown (e.g. DAS charging) count from the first tick.
  for (const k of allKeyboards) k.clearPending();
  pendingStart = soloKeys.heldEvents();
  pendingVersusStart = [versusKeys[0].heldEvents(), versusKeys[1].heldEvents()];
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
    banner = score[result] >= ROUNDS_TO_WIN ? `PLAYER ${result + 1} WINS!` : `PLAYER ${result + 1} TAKES THE ROUND`;
  }
  roundEndAt = now;
  show('roundEnd');
}

function showMatchResult(): void {
  if (!match) return;
  const winner = score[0] > score[1] ? 1 : 2;
  $('result-title').textContent = `Player ${winner} wins!`;
  $('result-time').textContent = `${score[0]} – ${score[1]}`;
  const [a, b] = match.players;
  $('result-detail').textContent = `Last round: P1 sent ${a.attackSent} lines, P2 sent ${b.attackSent} lines`;
  $('retry').textContent = 'Rematch (Enter)';
  show('result');
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
  const inputs: [KeyEvent[], KeyEvent[]] = [
    [...pendingVersusStart[0], ...versusKeys[0].take()],
    [...pendingVersusStart[1], ...versusKeys[1].take()],
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

  if (mode === 'versus' && match) {
    renderer.drawVersus(match, { countdown, popups, characters, score, roundsToWin: ROUNDS_TO_WIN, banner });
  } else {
    renderer.draw(mode === 'sprint' ? game : null, { goalLines: SPRINT_LINES, countdown, popup });
  }
  requestAnimationFrame(frame);
}

// ---- input ----------------------------------------------------------------

const inGame = () => screen === 'playing' || screen === 'countdown' || screen === 'roundEnd';

addEventListener('keydown', (e) => {
  // R restarts a sprint only: in versus it sits next to the left player's keys.
  if (e.code === 'KeyR' && mode === 'sprint' && (inGame() || screen === 'result')) {
    e.preventDefault();
    return startSprint();
  }
  if (e.code === 'Escape') {
    e.preventDefault();
    if (screen === 'settings') return closeSettings();
    if (screen !== 'menu') return show('menu');
  }
  if (e.code === 'Enter' && screen === 'menu') return startSprint();
  if (e.code === 'Enter' && screen === 'result') return retry();
  const keyboards = mode === 'sprint' ? [soloKeys] : versusKeys;
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
$('retry').addEventListener('click', retry);
$('to-menu').addEventListener('click', () => show('menu'));
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
  Object.assign(window, { lineBattle: { get match() { return match; }, characters } });
}
