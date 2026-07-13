# tworld Frontend Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `test-tile-world-ts`'s rendering closer to the original tworld desktop frontend: composite item/terrain tiles over their buried floor, animate creatures with smooth sub-tile movement, scroll the traditional viewport smoothly instead of snapping per tile, and restructure the HUD into a grouped panel with icon-based inventory.

**Architecture:** All changes are confined to `test-tile-world-ts` (a pure consumer of the `tworld-engine` package — no engine changes). `render.ts` owns all canvas-drawing logic; `main.ts` owns the game loop, DOM wiring, and per-tick `render()` orchestration; `index.html`/`style.css` own HUD markup/layout.

**Tech Stack:** TypeScript, Vite, HTML5 Canvas 2D, `tworld-engine` (existing dependency, no version change).

## Global Constraints

- No changes to the `tworld-engine` package — only its already-public exports (`Tile`, `Creature`, `GameSetup`, `NORTH`/`WEST`/`SOUTH`/`EAST`, `Game`, etc.) are used.
- No test framework exists in `test-tile-world-ts` (confirmed: `package.json` has no test script/dependency). Verification is `npx tsc --noEmit` (type safety) plus manual browser playtesting via `npm run dev`, per the approved design spec's Testing Approach section.
- Out of scope: sound, fullscreen, password entry/level select by password, hint-text panel, best-time tracking — none are wired up by this plan.
- Every task must leave `npx tsc --noEmit` passing with zero errors before it is considered done.

---

### Task 1: Composite buried tiles under non-creature top tiles in `drawBoard`

**Context:** `tworld-engine`'s map format stores two independent layers per cell (`top`/`bot`, loaded directly from the level's upper/lower RLE layers — see `tworld-engine/src/decoder.ts:151-172`). `bot` is `Tile.Empty` in the common case, but holds a real "buried" tile whenever the level places something on top of another tile (most commonly a creature standing on a special floor, but the two-layer format is not limited to creatures). The current `drawBoard` only ever draws one of `top`/`bot`, selected by `isCreatureId(cell.top.id)` — so any non-creature `top` tile with a non-`Empty` `bot` underneath currently hides the buried tile entirely instead of compositing over it the way `tworld/generic/tile.c`'s `getcellimage()` does.

**Files:**
- Modify: `test-tile-world-ts/src/render.ts:61-87` (`drawBoard`)

**Interfaces:**
- `drawBoard`'s signature is unchanged: `(ctx, tileset, map, viewport, cellSize) => void`.

- [ ] **Step 1: Rewrite `drawBoard` to always draw the buried tile then composite the top tile over it**

Replace the body of `drawBoard` in `test-tile-world-ts/src/render.ts`:

```ts
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  tileset: Tileset,
  map: MapCell[],
  viewport: Viewport,
  cellSize: number,
): void {
  for (let row = 0; row < viewport.height; row++) {
    for (let col = 0; col < viewport.width; col++) {
      const pos = (viewport.y0 + row) * GRID + (viewport.x0 + col);
      const cell = map[pos];
      if (!cell) continue;
      const x = col * cellSize;
      const y = row * cellSize;

      // bot is the buried tile (Empty in the common case, or the real
      // floor/terrain underneath top whenever the level's two-layer
      // format stacks something over it — most often a creature, but
      // not exclusively). Draw it first, then composite top over it
      // via the sprite's own alpha channel, unless top is a creature
      // id: creatures are drawn separately by drawCreatureOverlay so
      // they can be positioned mid-tile during movement.
      drawTile(ctx, tileset, cell.bot.id, x, y, cellSize);

      if (!isCreatureId(cell.top.id) && cell.top.id !== cell.bot.id) {
        drawTile(ctx, tileset, cell.top.id, x, y, cellSize);
      }
    }
  }
}
```

This removes the old `floorTile` ternary entirely; `bot` is now always drawn first, and `top` is layered on top whenever it isn't a creature and differs from `bot` (avoiding a redundant duplicate draw when both are e.g. `Empty`).

- [ ] **Step 2: Typecheck**

Run: `cd test-tile-world-ts && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run: `cd test-tile-world-ts && npm run dev`, open the printed local URL in a browser.

Confirm:
- The default level (`intro.dat` level 1) renders with no visual regressions — plain floor, walls, and terrain look identical to before this change (no double-draw artifacts, no flicker).
- Switch through a few levels via the `Level` dropdown and confirm walls/doors/buttons/terrain still render opaquely and fully cover the floor beneath them (opaque `top` tiles should look unchanged).
- Move Chip onto a special floor tile that also hosts other creatures/traps in the level data (e.g. any level with a bear trap or water tile a monster can stand on) and confirm the creature (drawn by the unchanged `drawCreatureOverlay` pass) still shows the correct floor peeking through beneath it — this is a regression check that Step 1 didn't break the creature-on-floor case.

- [ ] **Step 4: Commit**

```bash
cd test-tile-world-ts
git add src/render.ts
git commit -m "$(cat <<'EOF'
fix: composite buried tiles under non-creature top tiles

drawBoard previously drew either top or bot based on whether top was
a creature id, silently dropping any buried tile under a non-creature
top tile. Now bot is always drawn first and top is composited over it
via the sprite's alpha channel, matching tworld's getcellimage().

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Smooth sub-tile creature movement in `drawCreatureOverlay`

**Context:** `tworld-engine`'s `Creature.moving` field (confirmed in `tworld-engine/src/logic/lynx.ts:1356-1399`) works as follows: when a creature starts a move, its `pos` is updated immediately to the destination tile and `moving` is incremented by 8 (eighths of a tile); each subsequent tick, `moving` decrements (by 2 normally, 4 on ice/slide floors, 1 for Blob) until it reaches 0. So a creature with `moving > 0` should be drawn trailing *behind* its destination tile (opposite its direction of travel) by `moving/8` of a tile, easing into place as `moving` counts down — exactly matching `tworld/generic/tile.c`'s `getcreatureimage()` offset logic. The current `drawCreatureOverlay` ignores `moving` entirely and always draws at the exact destination tile, so movement visibly snaps every turn instead of gliding every tick.

**Files:**
- Modify: `test-tile-world-ts/src/render.ts:1-2` (imports), `:89-103` (`drawCreatureOverlay`)

**Interfaces:**
- `drawCreatureOverlay`'s creature array parameter type gains a required `moving: number` field. `main.ts` already passes `game.getCreatures()` (returns `tworld-engine`'s `Creature[]`, which already has `moving`) directly through, so no caller changes are needed.

- [ ] **Step 1: Import direction constants**

In `test-tile-world-ts/src/render.ts`, change the import line:

```ts
import { Tile, NORTH, WEST, SOUTH, EAST, type MapCell } from "tworld-engine";
```

- [ ] **Step 2: Add a sub-tile offset to `drawCreatureOverlay`**

Replace `drawCreatureOverlay` in `test-tile-world-ts/src/render.ts`:

```ts
export function drawCreatureOverlay(
  ctx: CanvasRenderingContext2D,
  tileset: Tileset,
  creatures: { pos: number; id: number; dir: number; hidden: boolean; moving: number }[],
  viewport: Viewport,
  cellSize: number,
): void {
  for (const cr of creatures) {
    if (cr.hidden) continue;
    const col = (cr.pos % GRID) - viewport.x0;
    const row = Math.floor(cr.pos / GRID) - viewport.y0;
    if (col < 0 || col >= viewport.width || row < 0 || row >= viewport.height) continue;

    // pos is already the destination tile once a move starts; moving
    // counts down from 8 to 0 (eighths of a tile) as the creature eases
    // into it, so it's drawn offset backward along its direction of
    // travel and slides forward as moving shrinks.
    let x = col * cellSize;
    let y = row * cellSize;
    const offset = (cr.moving * cellSize) / 8;
    switch (cr.dir) {
      case NORTH: y += offset; break;
      case WEST: x += offset; break;
      case SOUTH: y -= offset; break;
      case EAST: x -= offset; break;
    }

    drawTile(ctx, tileset, packedCreatureTile(cr), x, y, cellSize);
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `cd test-tile-world-ts && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `cd test-tile-world-ts && npm run dev`.

Confirm:
- Move Chip with an arrow key held down (or tap-and-hold on mobile emulation) and observe continuous gliding motion between tiles rather than an instant per-turn jump.
- Move Chip onto an ice or slide tile and confirm the glide is visibly faster (fewer, larger per-tick steps) than on normal floor, consistent with `moving` decrementing by 4 instead of 2 there.
- Switch to "Full map" viewport mode (`cellSize` 24 instead of 48) and confirm the same smooth motion is visible at the smaller scale (offset math scales with `cellSize`).
- Confirm other creatures in the level (if the loaded level has any) also glide smoothly, not just Chip.

- [ ] **Step 5: Commit**

```bash
cd test-tile-world-ts
git add src/render.ts
git commit -m "$(cat <<'EOF'
feat: smooth sub-tile creature movement

drawCreatureOverlay now reads Creature.moving (already exposed by
tworld-engine but previously unused) to offset each creature's sprite
along its direction of travel, so movement glides continuously between
ticks instead of snapping once per turn.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Smooth viewport scrolling in traditional (9×9) mode

**Context:** `computeViewport` currently takes Chip's tile-quantized column/row (`Math.floor(state.xviewpos / 8)` in `main.ts`) and returns a whole-tile-aligned window, so the camera jumps a full tile at a time as Chip crosses tile boundaries. `state.xviewpos`/`yviewpos` are already tracked by the engine in eighths-of-a-tile units and updated every tick during movement (`tworld-engine/src/logic/lynx.ts:1735-1747`), so continuous sub-tile scroll data is already available — it's just being floored away before use.

**Files:**
- Modify: `test-tile-world-ts/src/render.ts:1-42` (`Viewport` interface, `TRADITIONAL_SIZE` export, `computeViewport`), `:61-103` (`drawBoard`, `drawCreatureOverlay` — apply pixel offset)
- Modify: `test-tile-world-ts/src/main.ts:12` (import), `:144-173` (`render`)

**Interfaces:**
- `Viewport` gains two fields: `fracX: number`, `fracY: number` (0–7, the sub-tile remainder in eighths-of-a-tile, always 0 in `"full"` mode).
- `computeViewport(mode: ViewportMode, xviewpos: number, yviewpos: number): Viewport` — signature changes from `(mode, chipCol, chipRow)` (whole tiles) to `(mode, xviewpos, yviewpos)` (raw eighths-of-a-tile units, i.e. `state.xviewpos`/`state.yviewpos` passed straight through).
- `TRADITIONAL_SIZE` becomes an exported constant (was module-private) so `main.ts` can size the canvas correctly.
- `drawBoard`/`drawCreatureOverlay` signatures are unchanged, but their internal pixel math now subtracts `viewport.fracX`/`fracY` (converted to pixels) from every draw position.

- [ ] **Step 1: Widen `Viewport`, export `TRADITIONAL_SIZE`, add eighths-per-tile constant**

In `test-tile-world-ts/src/render.ts`, change:

```ts
export type ViewportMode = "full" | "traditional";
const TRADITIONAL_SIZE = 9;
```

to:

```ts
export type ViewportMode = "full" | "traditional";
export const TRADITIONAL_SIZE = 9;
const EIGHTHS_PER_TILE = 8;
```

And change the `Viewport` interface:

```ts
export interface Viewport {
  x0: number;
  y0: number;
  width: number;
  height: number;
  fracX: number;
  fracY: number;
}
```

- [ ] **Step 2: Rewrite `computeViewport` to work in eighths-of-a-tile units**

Replace the existing `computeViewport` function:

```ts
// xviewpos/yviewpos: Chip's raw view position in eighths-of-a-tile units
// (state.xviewpos/state.yviewpos, tracked continuously by the engine
// during movement — not floored to whole tiles).
export function computeViewport(mode: ViewportMode, xviewpos: number, yviewpos: number): Viewport {
  if (mode === "full") {
    return { x0: 0, y0: 0, width: GRID, height: GRID, fracX: 0, fracY: 0 };
  }
  const half = Math.floor(TRADITIONAL_SIZE / 2) * EIGHTHS_PER_TILE;
  const maxOriginEighths = (GRID - TRADITIONAL_SIZE) * EIGHTHS_PER_TILE;
  const originXEighths = clamp(xviewpos - half, 0, maxOriginEighths);
  const originYEighths = clamp(yviewpos - half, 0, maxOriginEighths);

  const x0 = Math.floor(originXEighths / EIGHTHS_PER_TILE);
  const y0 = Math.floor(originYEighths / EIGHTHS_PER_TILE);
  const fracX = originXEighths - x0 * EIGHTHS_PER_TILE;
  const fracY = originYEighths - y0 * EIGHTHS_PER_TILE;

  // Draw one extra row/column whenever there's a sub-tile remainder, so
  // the newly-exposed edge isn't blank while scrolling. The canvas is
  // sized to exactly TRADITIONAL_SIZE tiles (see main.ts), so this
  // extra tile is naturally clipped off by the canvas bounds.
  const width = Math.min(TRADITIONAL_SIZE + (fracX > 0 ? 1 : 0), GRID - x0);
  const height = Math.min(TRADITIONAL_SIZE + (fracY > 0 ? 1 : 0), GRID - y0);

  return { x0, y0, width, height, fracX, fracY };
}
```

- [ ] **Step 3: Apply the fractional pixel offset in `drawBoard` and `drawCreatureOverlay`**

In `drawBoard` (from Task 1's version), change the position calculation:

```ts
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  tileset: Tileset,
  map: MapCell[],
  viewport: Viewport,
  cellSize: number,
): void {
  const offX = (viewport.fracX * cellSize) / EIGHTHS_PER_TILE;
  const offY = (viewport.fracY * cellSize) / EIGHTHS_PER_TILE;
  for (let row = 0; row < viewport.height; row++) {
    for (let col = 0; col < viewport.width; col++) {
      const pos = (viewport.y0 + row) * GRID + (viewport.x0 + col);
      const cell = map[pos];
      if (!cell) continue;
      const x = col * cellSize - offX;
      const y = row * cellSize - offY;

      drawTile(ctx, tileset, cell.bot.id, x, y, cellSize);

      if (!isCreatureId(cell.top.id) && cell.top.id !== cell.bot.id) {
        drawTile(ctx, tileset, cell.top.id, x, y, cellSize);
      }
    }
  }
}
```

In `drawCreatureOverlay` (from Task 2's version), change the base position:

```ts
export function drawCreatureOverlay(
  ctx: CanvasRenderingContext2D,
  tileset: Tileset,
  creatures: { pos: number; id: number; dir: number; hidden: boolean; moving: number }[],
  viewport: Viewport,
  cellSize: number,
): void {
  const offX = (viewport.fracX * cellSize) / EIGHTHS_PER_TILE;
  const offY = (viewport.fracY * cellSize) / EIGHTHS_PER_TILE;
  for (const cr of creatures) {
    if (cr.hidden) continue;
    const col = (cr.pos % GRID) - viewport.x0;
    const row = Math.floor(cr.pos / GRID) - viewport.y0;
    if (col < 0 || col >= viewport.width || row < 0 || row >= viewport.height) continue;

    let x = col * cellSize - offX;
    let y = row * cellSize - offY;
    const moveOffset = (cr.moving * cellSize) / 8;
    switch (cr.dir) {
      case NORTH: y += moveOffset; break;
      case WEST: x += moveOffset; break;
      case SOUTH: y -= moveOffset; break;
      case EAST: x -= moveOffset; break;
    }

    drawTile(ctx, tileset, packedCreatureTile(cr), x, y, cellSize);
  }
}
```

- [ ] **Step 4: Wire the raw view position and fixed canvas size into `main.ts`**

In `test-tile-world-ts/src/main.ts`, change the import:

```ts
import { drawBoard, drawCreatureOverlay, computeViewport, CELL_SIZES, TRADITIONAL_SIZE, type ViewportMode } from "./render";
```

Then in `render()`, replace:

```ts
  const mode = currentViewportMode();
  const chipCol = Math.floor(state.xviewpos / 8);
  const chipRow = Math.floor(state.yviewpos / 8);
  const viewport = computeViewport(mode, chipCol, chipRow);
  const cellSize = CELL_SIZES[mode];

  canvas.width = viewport.width * cellSize;
  canvas.height = viewport.height * cellSize;
```

with:

```ts
  const mode = currentViewportMode();
  const viewport = computeViewport(mode, state.xviewpos, state.yviewpos);
  const cellSize = CELL_SIZES[mode];

  // The canvas is always sized to exactly the visible window
  // (TRADITIONAL_SIZE tiles, or the whole GRID in full mode); the
  // viewport itself may be one tile wider/taller than that to supply a
  // scroll buffer (see computeViewport), which the canvas clips off.
  const displayCols = mode === "full" ? viewport.width : TRADITIONAL_SIZE;
  const displayRows = mode === "full" ? viewport.height : TRADITIONAL_SIZE;
  canvas.width = displayCols * cellSize;
  canvas.height = displayRows * cellSize;
```

- [ ] **Step 5: Typecheck**

Run: `cd test-tile-world-ts && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `cd test-tile-world-ts && npm run dev`.

Confirm:
- With "Traditional (9x9)" view selected, walk Chip continuously across the middle of the map and confirm the camera scrolls smoothly pixel-by-pixel rather than jumping a full tile at a time.
- Walk Chip to each of the four map edges and confirm the camera stops scrolling and clamps cleanly at the edge (no blank tiles, no visible seam/tear at the clipped edge column/row).
- Switch to "Full map" view and confirm it still renders the entire 32×32 map exactly as before (regression check — `fracX`/`fracY` are always 0 there).
- Switch back and forth between the two viewport modes mid-game and confirm no crashes or stale canvas sizing.

- [ ] **Step 7: Commit**

```bash
cd test-tile-world-ts
git add src/render.ts src/main.ts
git commit -m "$(cat <<'EOF'
feat: smooth viewport scrolling in traditional view

computeViewport now works in eighths-of-a-tile units (state.xviewpos/
yviewpos, already tracked continuously by the engine) instead of
whole tiles, so the traditional 9x9 camera scrolls smoothly instead
of snapping a full tile at a time. The viewport draws one extra
row/column as a scroll buffer, clipped by a canvas fixed to exactly
9x9 tiles.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Grouped HUD panel with icon-based inventory

**Context:** The HUD is currently a flat list of text rows (`index.html:40-51`), including keys/boots rendered as plain text (`R:0 B:0 Y:0 G:0`). `tworld/oshw-sdl/sdlout.c`'s `displayinfo()` groups the panel into a title block (name/level/password), a chips+time row, and an inventory row that draws each key/boot as its actual sprite (or the `Empty` tile when not possessed). `tworld-engine`'s `GameSetup.passwd` (`tworld-engine/src/types.ts:41`) and `Tile.Key_Red`/`Tile.Boots_Ice` etc. (already used by `tileset.ts`) provide everything needed to reproduce this without any engine changes.

**Files:**
- Modify: `test-tile-world-ts/index.html:40-51` (`.hud` markup)
- Modify: `test-tile-world-ts/src/style.css:51-75` (HUD styling)
- Modify: `test-tile-world-ts/src/main.ts:1-33` (imports, element queries), `:110-127` (`startLevel`), `:144-173` (`render`)

**Interfaces:**
- No exported function signatures change; this task only touches `main.ts`'s DOM wiring.

- [ ] **Step 1: Restructure the HUD markup**

In `test-tile-world-ts/index.html`, replace the `<div class="hud">...</div>` block:

```html
        <div class="hud">
          <div class="panel-title">
            <div id="level-name">—</div>
            <div id="level-password" class="password"></div>
          </div>
          <div class="panel-row stats">
            <div class="stat">
              <span class="label">Chips</span>
              <span id="chips-needed">0</span>
            </div>
            <div class="stat">
              <span class="label">Time</span>
              <span id="time-left">—</span>
            </div>
          </div>
          <div class="panel-row inventory">
            <canvas class="icon-slot" id="key-0" width="24" height="24"></canvas>
            <canvas class="icon-slot" id="key-1" width="24" height="24"></canvas>
            <canvas class="icon-slot" id="key-2" width="24" height="24"></canvas>
            <canvas class="icon-slot" id="key-3" width="24" height="24"></canvas>
          </div>
          <div class="panel-row inventory">
            <canvas class="icon-slot" id="boot-0" width="24" height="24"></canvas>
            <canvas class="icon-slot" id="boot-1" width="24" height="24"></canvas>
            <canvas class="icon-slot" id="boot-2" width="24" height="24"></canvas>
            <canvas class="icon-slot" id="boot-3" width="24" height="24"></canvas>
          </div>
          <div id="status" class="status"></div>
          <p class="hint">
            Use arrow keys to move (click the board first), or on mobile tap
            the top/left/right/bottom of the board.
          </p>
        </div>
```

- [ ] **Step 2: Add HUD panel styling**

In `test-tile-world-ts/src/style.css`, replace the `.hud` rule and everything below it:

```css
.hud {
  min-width: 200px;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  font-size: 0.95rem;
}

.panel-title {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-weight: bold;
  border-bottom: 1px solid currentColor;
  padding-bottom: 0.4rem;
}

.password {
  font-weight: normal;
  opacity: 0.75;
  font-size: 0.85rem;
}

.panel-row {
  display: flex;
  gap: 1.5rem;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.stat .label {
  font-size: 0.75rem;
  opacity: 0.7;
  text-transform: uppercase;
}

.inventory {
  gap: 0.4rem;
}

.icon-slot {
  width: 24px;
  height: 24px;
  image-rendering: pixelated;
  border: 1px solid currentColor;
  border-radius: 3px;
  background: #888;
}

.status {
  font-weight: bold;
  min-height: 1.4em;
}

.status.win {
  color: #2e7d32;
}

.status.lose {
  color: #c62828;
}

.hint {
  opacity: 0.7;
  font-size: 0.8rem;
}
```

- [ ] **Step 3: Wire up new elements and icon rendering in `main.ts`**

Change the import line to include `Tile`:

```ts
import {
  Game,
  splitDatFile,
  Ruleset,
  Tile,
  NIL,
  NORTH,
  WEST,
  SOUTH,
  EAST,
  type GameSetup,
} from "tworld-engine";
```

Replace the element-query block (previously lines 25-34):

```ts
const levelSelect = document.querySelector<HTMLSelectElement>("#level-select")!;
const rulesetSelect = document.querySelector<HTMLSelectElement>("#ruleset-select")!;
const viewportSelect = document.querySelector<HTMLSelectElement>("#viewport-select")!;
const restartBtn = document.querySelector<HTMLButtonElement>("#restart-btn")!;
const levelNameEl = document.querySelector<HTMLElement>("#level-name")!;
const levelPasswordEl = document.querySelector<HTMLElement>("#level-password")!;
const chipsNeededEl = document.querySelector<HTMLElement>("#chips-needed")!;
const timeLeftEl = document.querySelector<HTMLElement>("#time-left")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;

const ICON_SIZE = 24;
const KEY_TILES = [Tile.Key_Red, Tile.Key_Blue, Tile.Key_Yellow, Tile.Key_Green];
const BOOT_TILES = [Tile.Boots_Ice, Tile.Boots_Slide, Tile.Boots_Fire, Tile.Boots_Water];
const keyIconCtxs = [0, 1, 2, 3].map(
  (n) => document.querySelector<HTMLCanvasElement>(`#key-${n}`)!.getContext("2d")!,
);
const bootIconCtxs = [0, 1, 2, 3].map(
  (n) => document.querySelector<HTMLCanvasElement>(`#boot-${n}`)!.getContext("2d")!,
);
for (const ctx of [...keyIconCtxs, ...bootIconCtxs]) {
  ctx.imageSmoothingEnabled = false;
}
```

This drops `keysEl`/`bootsEl` (no longer used as text spans).

In `startLevel()`, add the password line alongside the existing `levelNameEl` assignment:

```ts
  const setup = levels[index];
  if (!setup) return;
  game = new Game(setup, currentRuleset());
  levelNameEl.textContent = `#${setup.number} ${setup.name || "(untitled)"}`;
  levelPasswordEl.textContent = setup.passwd ? `Password: ${setup.passwd}` : "";
```

- [ ] **Step 4: Replace the text-based inventory update in `render()` with icon drawing**

In `render()`, replace:

```ts
  keysEl.textContent = `R:${state.keys[0]} B:${state.keys[1]} Y:${state.keys[2]} G:${state.keys[3]}`;
  bootsEl.textContent = `Ice:${state.boots[0]} Slide:${state.boots[1]} Fire:${state.boots[2]} Water:${state.boots[3]}`;
```

with:

```ts
  for (let n = 0; n < 4; n++) {
    keyIconCtxs[n]!.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
    drawTile(keyIconCtxs[n]!, tileset, state.keys[n] ? KEY_TILES[n]! : Tile.Empty, 0, 0, ICON_SIZE);
    bootIconCtxs[n]!.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
    drawTile(bootIconCtxs[n]!, tileset, state.boots[n] ? BOOT_TILES[n]! : Tile.Empty, 0, 0, ICON_SIZE);
  }
```

This requires `drawTile` to already be imported in `main.ts` from `./tileset` — check the existing import line (`import { loadTileset, type Tileset } from "./tileset";`) and add `drawTile`:

```ts
import { loadTileset, drawTile, type Tileset } from "./tileset";
```

- [ ] **Step 5: Typecheck**

Run: `cd test-tile-world-ts && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `cd test-tile-world-ts && npm run dev`.

Confirm:
- The HUD now shows a title block (level name), a password line (only when the level has one — most `intro.dat` levels won't, so confirm the line is simply blank/absent for those, with no leftover layout gap issues), a Chips/Time row side by side, and two rows of 8 total icon slots.
- All 8 icon slots initially show the empty/blank tile (no keys or boots collected yet).
- Walk Chip over a key or boots pickup in a level that has one and confirm the corresponding icon slot switches from blank to the correct colored key/boot sprite immediately upon pickup.
- Confirm the win/lose status text and the instructions hint paragraph still appear below the panel as before.

- [ ] **Step 7: Commit**

```bash
cd test-tile-world-ts
git add index.html src/style.css src/main.ts
git commit -m "$(cat <<'EOF'
feat: grouped HUD panel with icon-based inventory

Restructures the HUD into a title/password block, a chips+time row,
and icon-based key/boot inventory slots (rendered via the existing
tile sprites, showing Empty when not possessed) instead of plain text
rows, mirroring tworld's sdlout.c displayinfo() panel layout.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1 covers item/floor transparency compositing; Task 2 covers smooth Lynx movement; Task 3 covers smooth viewport scrolling (a spec requirement building on Task 2's premise); Task 4 covers the HUD/inventory panel. All four areas named in the approved spec are covered.
- **Type consistency:** `Viewport` (with `fracX`/`fracY`) is defined once in Task 3 Step 1 and consumed identically by `drawBoard`/`drawCreatureOverlay` in Task 3 Step 3 and by `main.ts` in Task 3 Step 4. `TRADITIONAL_SIZE` is exported once (Task 3 Step 1) and imported once (Task 3 Step 4). The creature array type (`{ pos, id, dir, hidden, moving }`) introduced in Task 2 Step 2 is reused unchanged by Task 3 Step 3.
- **Task ordering:** Tasks 1 and 2 both touch `drawBoard`/`drawCreatureOverlay`; Task 3 builds directly on Task 2's version of `drawCreatureOverlay` (adds the `offX`/`offY` viewport-fraction offset alongside the existing movement offset) and Task 1's version of `drawBoard`. Tasks must be executed in order 1 → 2 → 3 → 4.
