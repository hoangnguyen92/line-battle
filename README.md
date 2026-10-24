# Line Battle

A browser falling-block versus game in TypeScript. This is phase 1 of the plan:
the engine core and a playable single-player **40 Lines Sprint**.

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

DAS, ARR and soft drop speed are in **Handling settings** on the menu and are
saved in the browser.

## Layout

```
packages/
  engine/   pure, deterministic game logic, no dependencies (shared later by bot and server)
    src/game.ts     the game state machine: input, DAS/ARR, gravity, lock delay, hold, clears
    src/srs.ts      SRS wall kicks, plus 180-degree kicks
    src/pieces.ts   piece shapes and rotation states
    src/bag.ts      seeded 7-bag randomizer
    src/board.ts    10 x 40 board (20 visible rows), line clears
    src/replay.ts   input recorder and replay runner
    test/           Vitest tests
  web/      Vite + Canvas 2D client
    src/main.ts     screens, 60 Hz fixed-step loop, sprint flow
    src/render.ts   canvas drawing
    src/input.ts    keyboard bindings
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
