import { DEFAULT_HANDLING, Game, randomSeed, Recorder, SDF_INSTANT, TICK_RATE, type ClearInfo, type GameConfig, type KeyEvent, type Replay } from '@line-battle/engine';
import { Keyboard } from './input';
import { formatTime, Renderer, type Popup } from './render';
import { loadBestTicks, loadHandling, saveBestTicks, saveHandling } from './settings';

const SPRINT_LINES = 40;
const TICK_MS = 1000 / TICK_RATE;
const COUNTDOWN_STEP_MS = 500;
const COUNTDOWN = ['3', '2', '1'];
/** Never simulate more than this many ticks per frame (e.g. after a tab switch). */
const MAX_CATCH_UP = 8;

type Screen = 'menu' | 'settings' | 'countdown' | 'playing' | 'result';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const renderer = new Renderer($<HTMLCanvasElement>('game'));
const keyboard = new Keyboard();

let screen: Screen = 'menu';
let handling = loadHandling();
let game: Game | null = null;
let recorder: Recorder | null = null;
let lastReplay: Replay | null = null;
let popup: Popup | null = null;
/** Keys already held when play starts, fed into the first tick. */
let pendingStart: KeyEvent[] = [];
let countdownStart = 0;
let lastFrame = performance.now();
let accumulator = 0;

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

function startSprint(): void {
  const config: GameConfig = { seed: randomSeed(), handling: { ...handling }, goalLines: SPRINT_LINES };
  game = new Game(config);
  recorder = new Recorder(config);
  popup = null;
  keyboard.clearPending();
  countdownStart = performance.now();
  show('countdown');
}

function beginPlay(): void {
  // Keys held through the countdown (e.g. DAS charging) count from the first tick.
  keyboard.clearPending();
  pendingStart = keyboard.heldEvents();
  accumulator = 0;
  show('playing');
}

function endGame(): void {
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
  show('result');
}

// ---- simulation -----------------------------------------------------------

function stepGame(): void {
  if (!game || !recorder) return;
  const events = [...pendingStart, ...keyboard.take()];
  pendingStart = [];
  for (const e of events) recorder.record(game.tick, e.key, e.down);
  game.step(events);
  for (const ev of game.drainEvents()) {
    if (ev.type === 'clear') popup = { lines: describeClear(ev.info), at: performance.now() };
  }
  if (game.over) endGame();
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
      stepGame();
      accumulator -= TICK_MS;
      n++;
    }
    if (n === MAX_CATCH_UP) accumulator = 0;
  }

  renderer.draw(game, { goalLines: SPRINT_LINES, countdown, popup });
  requestAnimationFrame(frame);
}

// ---- input ----------------------------------------------------------------

addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && (screen === 'playing' || screen === 'countdown' || screen === 'result')) {
    e.preventDefault();
    return startSprint();
  }
  if (e.code === 'Escape') {
    e.preventDefault();
    if (screen === 'settings') return closeSettings();
    if (screen !== 'menu') return show('menu');
  }
  if (e.code === 'Enter' && screen === 'menu') return startSprint();
  if (keyboard.keyDown(e.code) && screen !== 'menu' && screen !== 'settings') e.preventDefault();
});
addEventListener('keyup', (e) => {
  if (keyboard.keyUp(e.code) && screen === 'playing') e.preventDefault();
});
addEventListener('blur', () => keyboard.releaseAll());

// ---- menu and settings ----------------------------------------------------

$('start').addEventListener('click', startSprint);
$('retry').addEventListener('click', startSprint);
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
  a.download = `line-battle-sprint-${Date.now()}.json`;
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
