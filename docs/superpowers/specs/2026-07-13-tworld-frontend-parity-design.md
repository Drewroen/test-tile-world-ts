# tworld Frontend Parity — Design

## Purpose

`test-tile-world-ts` is a browser demo of `tworld-engine` (the TypeScript port of Tile World / Chip's Challenge game logic). Its rendering is currently much cruder than the original tworld desktop frontend (`tworld/generic/tile.c`, `tworld/oshw-sdl/sdlout.c`): creatures snap instantly between tiles instead of gliding, items on floor tiles fully replace the floor graphic instead of compositing over it, the traditional windowed viewport snaps a full tile at a time instead of scrolling smoothly, and the HUD is a plain list of text rows instead of a grouped panel with inventory icons.

This spec brings visual behavior for these four areas closer to the original, using data the engine (`tworld-engine`) already exposes.

## Background / current state

- `test-tile-world-ts/src/render.ts` — `drawBoard()` draws exactly one of `cell.top`/`cell.bot` per cell (whichever isn't a creature id). `drawCreatureOverlay()` places creatures at their integer tile position only. `computeViewport()` clamps the traditional 9×9 window to whole-tile boundaries.
- `test-tile-world-ts/src/main.ts` — runs `game.doTurn()` every tick (1000/20 = 50ms, `TICKS_PER_SECOND = 20`) and calls `render()` after every tick, so per-tick (not just per-turn) rendering data is already available.
- `tworld-engine`'s `Creature` type (`src/types.ts`) already exposes `moving: number` (eighths of a tile remaining to travel, matching the C engine's semantics) and `dir`, but the frontend does not read `moving`.
- `tworld-engine`'s `GameState` (`src/state.ts`) exposes `xviewpos`/`yviewpos` in eighths-of-a-tile units (already used, but only after being floored to whole tiles).
- The original C renderer's reference behavior:
  - `generic/tile.c:getcreatureimage()` offsets a creature's draw rect by `moving * tileSize / 8` in the direction of travel.
  - `generic/tile.c:getcellimage()` draws the floor (`bot`) tile, then alpha-composites the top tile over it via `addtransparenttile()` when the top tile has transparent pixels and isn't `Empty`/`Nothing`.
  - `generic/tile.c:_displaymapview()` computes the windowed viewport origin (`xdisppos`/`ydisppos`) in eighths-of-a-tile units directly from `xviewpos`/`yviewpos`, giving continuous scrolling.
  - `oshw-sdl/sdlout.c:displayinfo()` lays out a grouped info panel: title/level-number/password block, a chips/time row, and an inventory row that draws each key/boot icon (or `Empty` if not possessed).

## Design

### 1. Item + floor transparency compositing

In `drawBoard()` (`render.ts`), for each cell:
1. Always draw `cell.bot` first (the floor).
2. If `cell.top.id` is not a creature id (per the existing `isCreatureId()` check) and `cell.top.id !== cell.bot.id`, draw `cell.top` on top of it. The sprite sheet is already alpha-keyed (magenta chroma-key stripped in `tileset.ts`'s `loadTileset()`), so `ctx.drawImage` naturally composites transparent pixels — no new blending logic is needed beyond drawing both layers in order.
3. If `cell.top.id` is a creature id, keep current behavior: draw the floor (`bot`) only here; the creature itself is drawn by the separate creature-overlay pass.

This replaces the current either/or `floorTile` selection with an always-floor-then-maybe-item draw.

### 2. Smooth Lynx-style creature movement

In `drawCreatureOverlay()` (`render.ts`), extend the creature type accepted to include `moving: number` and use it to offset the sprite's draw position:

- `moving` ranges 0–7 (eighths of a tile remaining until the creature completes its move into `pos`... verify against engine semantics during implementation: confirm whether `moving` counts down to 0 or up from 0, and whether the creature's `pos` already reflects the destination tile or the tile it's leaving, then derive the sign/direction of the pixel offset accordingly).
- The offset direction is opposite the creature's direction of travel (`dir`), reproducing `getcreatureimage()`'s `rect->y += moving * htile/8` (NORTH), `rect->x += moving*wtile/8` (WEST), `rect->y -= moving*htile/8` (SOUTH), `rect->x -= moving*wtile/8` (EAST) — i.e., the creature is drawn trailing behind its destination tile and eases in as `moving` decreases.
- Compute the offset in the same `cellSize` units already used for drawing (`moving * cellSize / 8`), so it scales correctly for both "full" and "traditional" viewport modes.

`main.ts`'s call to `drawCreatureOverlay` already passes `game.getCreatures()` results directly; no change needed there beyond the type accepted by `drawCreatureOverlay` (already includes `moving` per `Creature`, just currently declared with a narrower inline type in `render.ts` that must be widened to include `moving`).

### 3. Smooth viewport scrolling (traditional mode)

`computeViewport()` (`render.ts`) currently takes `chipCol`/`chipRow` as whole-tile integers (`Math.floor(state.xviewpos / 8)` in `main.ts`) and returns a whole-tile-aligned `Viewport`.

Change:
- `computeViewport` (or a new sibling function) takes the raw `xviewpos`/`yviewpos` in eighths-of-a-tile units directly, and computes a viewport origin that includes a fractional (sub-tile) component, mirroring `_displaymapview`'s `xdisppos = state->xviewpos / 2 - (NXTILES/2) * 4` (that division reflects the C code's own eighths-to-quarters conversion — reproduce the equivalent math directly against eighths-of-a-tile units rather than porting the intermediate `/2` literally) clamped to `[0, (GRID - TRADITIONAL_SIZE) * 8]` in eighths-of-a-tile units.
- `drawBoard`/`drawCreatureOverlay` need the fractional part of the viewport origin (in pixels: `fractionalEighths * cellSize / 8`) subtracted from every tile's draw position, and must draw one extra row/column at the edges so the newly-exposed edge isn't blank while scrolling. (Simplest approach: render a `(TRADITIONAL_SIZE + 1) x (TRADITIONAL_SIZE + 1)` tile buffer offset by the fractional pixel amount, then let the canvas element's size stay fixed at `TRADITIONAL_SIZE * cellSize` — i.e., draw one tile beyond each edge and let the canvas clip it.)
- "full" mode is unaffected — it always shows the whole map, no camera to scroll.

### 4. HUD: grouped info panel + icon-based inventory

Restructure `index.html`'s `.hud` block and `main.ts`'s `render()` HUD-update code into three grouped sections, styled via `style.css`, modeled on `sdlout.c`'s `layoutscreen`/`displayinfo`:

- **Title block:** existing `#level-name` (already shows `#N name`), plus password (`GameSetup.passwd`) shown only when non-empty, e.g. `Password: XXXX`.
- **Chips/Time row:** two side-by-side label/value pairs — `Chips` / `state.chipsneeded`, `Time` / seconds-left (`∞` when untimed, matching current behavior) — laid out horizontally instead of stacked.
- **Inventory row:** replace the `#keys`/`#boots` text spans with 8 small `<canvas>` icon slots (4 keys + 4 boots), each rendered via the existing `drawTile()`/`tileset` helpers at a small fixed size (e.g. 24px). For each slot: draw `Tile.Key_Red + n` (etc.) if `state.keys[n]` is truthy, otherwise draw `Tile.Empty` — mirroring `displayinfo()`'s `(state->keys[n] ? Key_Red+n : Empty)`. Icons are re-drawn each `render()` call (inventory rarely changes, but this keeps it simple and consistent with the rest of the render loop rather than diffing state).
- **Status/message line:** unchanged — keep `#status` showing win/lose text below the panel.

No hint-text or best-time elements: `tworld-engine`'s `GameState` does not expose `hinttext` or a best-time value, so those parts of the original panel have no data source and are out of scope for this change.

## Out of scope

- Any change to `tworld-engine` itself — this is a frontend-only change, using fields the engine already exposes.
- Sound effects, fullscreen mode, password-based level selection/entry, hint-text display, best-time tracking/display — none of these have supporting engine state.
- The "full" viewport mode's scrolling behavior (it doesn't scroll).

## Testing approach

This is a visual/interactive demo with no existing test suite covering rendering (`tworld-engine` has its own `test/` directory for engine logic; `test-tile-world-ts` has none). Verification is via manual play-testing in a browser: confirm items visibly composite over floor tiles, creatures glide smoothly between tiles frame-to-frame, the traditional viewport scrolls smoothly as Chip approaches its clamped edges and mid-map, and the HUD shows grouped panel layout with correct icon-based inventory that updates as keys/boots are collected.
