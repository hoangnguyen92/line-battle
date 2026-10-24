# Line Battle

A browser falling-block versus game in TypeScript. Phase 1 built the engine
core and a single-player **40 Lines Sprint**. Phase 2 adds damage, garbage and
**local versus**: two players on one keyboard, first to 2 rounds. Phase 3 adds a
bot with 5 difficulty levels: **Versus bot** and the **Gauntlet** (beat all 5 in a row).

## Run it

You need Node.js 20 or newer.

```bash
npm install
npm run dev        # opens the game at http://localhost:5173
npm test           # engine unit tests (Vitest)
npm run typecheck  # TypeScript checks for both packages
npm run build      # production build in packages/web/dist
```

## Controls

| Action | Keys |
| --- | --- |
| Move | Left / Right arrows |
| Soft drop | Down arrow |
| Hard drop | Space |
| Rotate clockwise | Up arrow or X |
| Rotate counter-clockwise | Z or Ctrl |
| Rotate 180 | A |
| Hold | C or Shift |
| Restart / menu | R / Esc |

Versus bot and the gauntlet use the same keys as the sprint (R does not restart).

Local versus:

| Action | Player 1 | Player 2 |
| --- | --- | --- |
| Move | A / D | Left / Right |
| Soft drop | S | Down |
| Hard drop | W | Up |
| Rotate clockwise | E | . |
| Rotate counter-clockwise | Q | , |
| Rotate 180 | Z | / |
| Hold | Left Shift | Right Shift |
| Menu | Esc | Esc |

DAS, ARR and soft drop speed are in **Handling settings** on the menu and are
saved in the browser.

## Layout

```
packages/
  engine/   pure, deterministic game logic, no dependencies (shared by the bot and, later, the server)
    src/game.ts     the game state machine: input, DAS/ARR, gravity, lock delay, hold, clears, garbage
    src/attack.ts   the attack table: lines sent per clear, plus B2B, combo and perfect clear bonuses
    src/match.ts    a 1v1 round: two games on one tick, attacks routed between them, match replays
    src/srs.ts      SRS wall kicks, plus 180-degree kicks
    src/pieces.ts   piece shapes and rotation states
    src/bag.ts      seeded 7-bag randomizer
    src/board.ts    10 x 40 board (20 visible rows), line clears
    src/replay.ts   input recorder and replay runner
    test/           Vitest tests
  bot/      the PvE bot, built on the engine
    src/movegen.ts     every reachable spot for a piece (taps, tucks, spins)
    src/evaluate.ts    board and move scoring, T-spin slot detection
    src/search.ts      beam search over the preview; think(snapshot, level) -> plan
    src/levels.ts      the 5 difficulty levels
    src/controller.ts  turns a plan into key taps at the level's speed
    test/              Vitest tests, including bot-vs-bot matches
  web/      Vite + Canvas 2D client
    src/main.ts       screens, 60 Hz fixed-step loop, sprint and versus flow
    src/render.ts     canvas drawing, one board or two side by side
    src/character.ts  placeholder characters and falling-object hits
    src/input.ts      keyboard bindings (sprint, player 1, player 2)
    src/bot-worker.ts the bot's search in a Web Worker, so it never stalls rendering
    src/bot-client.ts talks to the worker (falls back to the main thread if workers fail)
```

## How the engine works

- The game runs at a fixed 60 ticks per second, separate from rendering.
  Every key press and release is fed in with its tick number, so the same seed
  plus the same inputs always gives the same game. That is what replays, the
  bot and server-side validation will build on.
- Integer-only math: gravity is fixed point (65536 = one row per tick), timers
  are in ticks.
- Defaults follow the plan: 7-bag, 5-piece preview, one hold per piece, SRS,
  500 ms lock delay with 15 resets, DAS 10 frames (167 ms), ARR 3 frames (50 ms), SDF 6.
- After a piece locks there is a 100 ms entry delay before the next one appears.
  Presses during it are ignored, so a hard drop can't spill into the next piece,
  and a held arrow has to charge DAS again before it slides the new piece.
- Each clear reports lines, T-spin kind (3-corner rule, with minis), perfect
  clear, back-to-back and combo, ready for the damage system in phase 2.
- After a run you can download its replay as JSON; `playReplay()` re-runs it.

## Damage and garbage (phase 2)

Each clear attacks with a base value plus bonuses:

| Clear | Lines sent |
| --- | --- |
| Single / Double / Triple / QUAD | 0 / 1 / 2 / 4 |
| T-spin single / double / triple | 2 / 4 / 6 |
| T-spin mini single / double | 0 / 1 |
| Perfect clear | +10 on top |
| Back-to-back (QUAD or T-spin after another) | +1 |
| Combo 1-2 / 3-4 / 5-6 / 7-9 / 10+ | +1 / +2 / +3 / +4 / +5 |

- **Cancel first.** An attack first cancels garbage waiting for you; only the rest is sent.
- **Delay.** Received garbage waits 20 ticks (~330 ms), shown orange in the bar beside the
  board, then turns red.
- **Rise on lock.** Red garbage rises when you lock a piece that clears nothing, at most
  8 lines per lock. Clearing (a combo) holds it back.
- **Holes.** All lines of one attack share a hole column; the next attack moves it 30% of
  the time.
- These are config options on `Game` (`garbageDelay`, `garbageCap`, `garbageMessiness`)
  so they can be tuned.

**Characters.** Each attack drops an object on the opponent's character, picked from the
lines before cancelling: 1 apple, 2 flowerpot, 3 bowling ball, 4 anvil, 5-6 piano,
7-9 cow, 10+ car. A fully cancelled attack bounces off an umbrella. These are
placeholder shapes; real art comes in phase 6.

## The bot (phase 3)

The bot plays by the same rules as a person: it only decides where each piece
goes, then presses keys for it at a capped speed. It plays its own `Game` in
the same `Match`, so it gets the same pieces and garbage as you.

For each piece it:

1. **Finds every reachable spot** for the current piece and the hold piece by
   searching taps from where the piece is (moves, rotations with SRS kicks,
   soft drops), which includes tucks and T-spins.
2. **Looks ahead** with a beam search over the next pieces in the preview,
   keeping the best few boards at each step.
3. **Scores boards** for height, holes, bumpiness, a well for QUADs and ready
   T-spin slots, and **scores moves** for what they clear and send. The weights
   start from the open-source Cold Clear bot's defaults.
4. **Taps the plan out**, then hard drops, timed so it keeps its level's speed.

| Level | Pieces per second | Looks ahead | T-spins | Mistakes |
| --- | --- | --- | --- | --- |
| 1 Beginner | 0.8 | current piece only, no hold | no | 1 piece in 5 |
| 2 Casual | 1.3 | 1 preview | no | 12% |
| 3 Intermediate | 2.0 | 2 previews | T-spin doubles | 4% |
| 4 Advanced | 3.0 | 3 previews | all, keeps back-to-back | 1% |
| 5 Expert | 4.0 | 5 previews | all | none |

Levels and weights live in `packages/bot/src/levels.ts`, so tuning a level is
a one-line change. In bot-vs-bot tests every level beats the one below it.
