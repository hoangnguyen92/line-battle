import { Game, type GameConfig, type Key } from './game';

export interface ReplayInput {
  tick: number;
  key: Key;
  down: boolean;
}

/** Everything needed to re-run a game exactly: its config and timed inputs. */
export interface Replay {
  version: 1;
  config: GameConfig;
  inputs: ReplayInput[];
  /** Tick count when the recording stopped. */
  ticks: number;
}

/** Records the inputs fed to a game so it can be replayed later. */
export class Recorder {
  readonly inputs: ReplayInput[] = [];

  constructor(readonly config: GameConfig) {}

  record(tick: number, key: Key, down: boolean): void {
    this.inputs.push({ tick, key, down });
  }

  finish(ticks: number): Replay {
    return { version: 1, config: this.config, inputs: [...this.inputs], ticks };
  }
}

/** Re-runs a replay from scratch and returns the finished game. */
export function playReplay(replay: Replay): Game {
  const game = new Game(replay.config);
  let i = 0;
  while (game.tick < replay.ticks && !game.over) {
    const batch = [];
    while (i < replay.inputs.length && replay.inputs[i].tick === game.tick) batch.push(replay.inputs[i++]);
    game.step(batch);
  }
  return game;
}
