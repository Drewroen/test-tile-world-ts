# Sets Page + Hash Routing UI Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-page toolbar (set/level/password/ruleset/view/fullscreen controls) with a default "sets" landing page and a per-set game page reachable at a bookmarkable/reloadable URL that also encodes the chosen ruleset (MS or Lynx), while dropping password lookup, the view-size picker (always 9x9 "traditional"), and the fullscreen button entirely.

**Architecture:** This is a vanilla TypeScript + Vite static site (no framework, no router library, no test runner) deployed to GitHub Pages with no server-side rewrite rule. A real path-based route (e.g. `/CCLP1/ms`) would 404 on a hard reload or bookmark open, since GitHub Pages has nothing to fall back to `index.html`. Hash-based routing (`#/CCLP1/ms`) sidesteps that entirely: the server always serves `index.html` for any hash, and only client-side JS reads `location.hash`. `index.html` gets two top-level sections, `#sets-page` and `#game-page`, toggled by a `.hidden { display: none; }` class based on the parsed hash. A new pure-function module, `src/routing.ts`, owns parsing/building the hash so that logic isn't tangled into `main.ts`'s DOM wiring.

**Tech Stack:** TypeScript, Vite, `tworld-engine` (game engine dependency), vanilla DOM APIs. No test runner is configured in this project (confirmed: `package.json` has only `dev`/`build`/`preview` scripts, no vitest/jest, no `*.test.*` files under `src/`). Per this repo's user-level instruction to make only the requested changes with as little footprint as possible, this plan does **not** introduce a new test framework. Each task is instead verified with `npx tsc --noEmit` (full strict type-check; `vite build` alone does not type-check) plus a manual `npm run dev` walkthrough described step-by-step in that task.

## Global Constraints

- No path segment of the route may 404 on a hard reload — this is why routing uses `location.hash`, not `history.pushState` with real paths.
- The sets page is the default/root route (empty or `#`/`#/`).
- A game route has the shape `#/<setId>/<ms|lynx>` where `<setId>` is `encodeURIComponent`-escaped so set names with spaces/apostrophes/etc. round-trip losslessly.
- Password lookup UI (`#password-input`, `#password-go-btn`, `#password-error`, `goToPassword()`) is removed entirely. The read-only per-level password readout in the HUD (`#level-password`, showing e.g. "Password: BLIH" for the level currently being played) is unrelated display info, not the password-lookup *functionality*, and stays.
- The view-size picker (`#viewport-select`) is removed; the board always renders in `"traditional"` (9×9) mode. `render.ts`'s `ViewportMode` type and `"full"` mode are left as-is (not requested to change) — `main.ts` simply stops offering `"full"` as a choice.
- The fullscreen button (`#fullscreen-btn`) and its `document.fullscreenElement`/`requestFullscreen()` wiring are removed, along with the now-orphaned `.game-area:fullscreen` CSS rule.
- Ruleset (MS/Lynx) is chosen on the sets page, per set, and baked into the route — no in-game ruleset selector.
- `npx tsc --noEmit` must pass with zero errors after every task.

---

### Task 1: Routing helpers (`src/routing.ts`)

**Files:**
- Create: `src/routing.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no DOM, no imports).
- Produces (used by Task 3's `main.ts`): `export type RulesetSlug = "ms" | "lynx"`, `export interface Route { setId: string; ruleset: RulesetSlug; }`, `export function parseHash(hash: string): Route | null`, `export function buildHash(setId: string, ruleset: RulesetSlug): string`.

- [ ] **Step 1: Write `src/routing.ts`**

```typescript
export type RulesetSlug = "ms" | "lynx";

export interface Route {
  setId: string;
  ruleset: RulesetSlug;
}

// Route state lives in the URL hash (e.g. "#/CCLP1/ms") rather than a real
// path, since this app deploys as a static site on GitHub Pages with no
// server-side rewrite to fall back to index.html on a deep-link reload.
export function parseHash(hash: string): Route | null {
  const trimmed = hash.replace(/^#\/?/, "");
  if (!trimmed) return null;

  const parts = trimmed.split("/");
  if (parts.length !== 2) return null;

  const [rawSetId, rawRuleset] = parts;
  if (rawRuleset !== "ms" && rawRuleset !== "lynx") return null;
  if (!rawSetId) return null;

  return { setId: decodeURIComponent(rawSetId), ruleset: rawRuleset };
}

export function buildHash(setId: string, ruleset: RulesetSlug): string {
  return `#/${encodeURIComponent(setId)}/${ruleset}`;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (the file is self-contained and isn't imported anywhere yet, so this just confirms it compiles standalone).

- [ ] **Step 3: Manual sanity check of the parsing logic**

Run: `node -e "
const hash = '#/CCLP1%20Set/ms';
const trimmed = hash.replace(/^#\/?/, '');
const parts = trimmed.split('/');
console.log(parts, decodeURIComponent(parts[0]));
"`
Expected output: `[ 'CCLP1%20Set', 'ms' ] CCLP1 Set` — confirms the regex strip and split behave as `parseHash` assumes for a name containing a space.

- [ ] **Step 4: Commit**

```bash
git add src/routing.ts
git commit -m "feat: add hash-route parsing/building helpers"
```

---

### Task 2: Restructure `index.html` and `src/style.css` into sets page + game page

**Files:**
- Modify (full rewrite): `index.html`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used by Task 3's `main.ts` DOM queries): element ids `#sets-page`, `#sets-status`, `#sets-list`, `#game-page`, `#back-to-sets-btn`, `#level-select`, `#ruleset-readout`, `#restart-btn`, `#set-status`, plus the unchanged HUD ids (`#board`, `#level-name`, `#level-password`, `#chips-needed`, `#time-left`, `#best-time`, `#key-0..3`, `#boot-0..3`, `#hint-panel`, `#status`). Removed ids that Task 3 must stop referencing: `#set-select`, `#password-input`, `#password-go-btn`, `#password-error`, `#ruleset-select`, `#viewport-select`, `#fullscreen-btn`.

- [ ] **Step 1: Replace `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>tworld-engine demo</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <div id="app">
      <div id="sets-page">
        <h1>tworld-engine demo</h1>
        <p class="subtitle">
          A TypeScript port of the Tile World (Chip's Challenge) game logic
          — pick a set to play in the browser.
        </p>
        <div id="sets-status" class="set-status"></div>
        <ul id="sets-list" class="sets-list"></ul>
      </div>

      <div id="game-page" class="hidden">
        <div class="toolbar">
          <button id="back-to-sets-btn">&larr; Sets</button>
          <label>
            Level:
            <select id="level-select"></select>
          </label>
          <span id="ruleset-readout" class="ruleset-readout"></span>
          <button id="restart-btn">Restart</button>
        </div>
        <div id="set-status" class="set-status"></div>

        <div class="game-area" id="game-area">
          <canvas id="board" width="512" height="512"></canvas>
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
              <div class="stat">
                <span class="label">Best</span>
                <span id="best-time">—</span>
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
            <div id="hint-panel" class="hint-panel"></div>
            <div id="status" class="status"></div>
            <p class="hint">
              Use arrow keys to move (click the board first), or on mobile tap
              the top/left/right/bottom of the board.
            </p>
          </div>
        </div>
      </div>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Update `src/style.css`**

Remove the now-orphaned fullscreen rule:

```css
.game-area:fullscreen {
  width: 100vw;
  height: 100vh;
  align-items: center;
  justify-content: center;
  background: #000;
  padding: 1rem;
}
```

Remove the now-orphaned password-error rule:

```css
.password-error {
  color: #c62828;
  font-size: 0.85rem;
}
```

Add a `.hidden` utility and sets-page list styling (insert after the `.set-status.error` block):

```css
.hidden {
  display: none;
}

.sets-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.set-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid currentColor;
  border-radius: 4px;
}

.set-name {
  font-size: 0.95rem;
}

.set-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.ruleset-readout {
  font-size: 0.9rem;
  opacity: 0.85;
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: errors referencing `src/main.ts` (it still queries the ids just removed from `index.html`, e.g. `#set-select`, `#password-input`) — that's expected at this point since `main.ts` isn't updated until Task 3. Confirm the errors are *only* in `src/main.ts` and only about the DOM-id mismatches, nothing in `index.html` or `src/style.css` (those aren't type-checked, just visually confirm no leftover references to removed ids by re-reading the two files above).

- [ ] **Step 4: Commit**

```bash
git add index.html src/style.css
git commit -m "feat: restructure markup into sets page and game page"
```

---

### Task 3: Rewire `src/main.ts` — routing, sets page, remove password/viewport/fullscreen

**Files:**
- Modify (full rewrite): `src/main.ts`

**Interfaces:**
- Consumes: `parseHash`, `buildHash`, `type RulesetSlug` from `./routing` (Task 1); the ids produced by Task 2's `index.html`; `computeViewport`, `CELL_SIZES`, `TRADITIONAL_SIZE`, `drawBoard`, `drawCreatureOverlay` from `./render` (unchanged, `ViewportMode` type import is dropped since the literal `"traditional"` string is passed directly).
- Produces: nothing consumed by later tasks (this is the last task).

- [ ] **Step 1: Replace `src/main.ts`**

```typescript
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
  SF_SHOWHINT,
  type GameSetup,
} from "tworld-engine";
import { drawBoard, drawCreatureOverlay, computeViewport, CELL_SIZES, TRADITIONAL_SIZE } from "./render";
import { loadTileset, drawTile, type Tileset } from "./tileset";
import { SoundManager } from "./sound";
import { getBestTime, recordTime } from "./besttime";
import { parseHash, buildHash, type RulesetSlug } from "./routing";

// The engine advances 20 ticks per (game) second — a fixed invariant of the
// original C source (gen.h's TICKS_PER_SECOND), not part of the public API
// since a host only needs to drive doTurn() at this cadence, not read the
// constant back.
const TICKS_PER_SECOND = 20;

const canvas = document.querySelector<HTMLCanvasElement>("#board")!;
const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;

const setsPageEl = document.querySelector<HTMLDivElement>("#sets-page")!;
const gamePageEl = document.querySelector<HTMLDivElement>("#game-page")!;
const setsListEl = document.querySelector<HTMLUListElement>("#sets-list")!;
const setsStatusEl = document.querySelector<HTMLElement>("#sets-status")!;
const backToSetsBtn = document.querySelector<HTMLButtonElement>("#back-to-sets-btn")!;
const rulesetReadoutEl = document.querySelector<HTMLElement>("#ruleset-readout")!;

const levelSelect = document.querySelector<HTMLSelectElement>("#level-select")!;
const restartBtn = document.querySelector<HTMLButtonElement>("#restart-btn")!;
const levelNameEl = document.querySelector<HTMLElement>("#level-name")!;
const levelPasswordEl = document.querySelector<HTMLElement>("#level-password")!;
const chipsNeededEl = document.querySelector<HTMLElement>("#chips-needed")!;
const timeLeftEl = document.querySelector<HTMLElement>("#time-left")!;
const bestTimeEl = document.querySelector<HTMLElement>("#best-time")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const hintPanelEl = document.querySelector<HTMLElement>("#hint-panel")!;
const setStatusEl = document.querySelector<HTMLElement>("#set-status")!;

// Gliderbot's public mirror of the official CC1 level sets. It's a plain
// directory listing (Apache/nginx autoindex), so the set list is scraped
// by pulling out every <a href> that points at a .dat file rather than
// relying on any particular page layout.
const CC1_SETS_INDEX_URL = "https://bitbusters.club/gliderbot/sets/cc1/";

interface DatSet {
  id: string;
  name: string;
  url: string;
}

// Bundled locally (public/intro.dat) rather than fetched from the network,
// so it's always in availableSets — even before (or if) the bitbusters.club
// fetch below completes — which lets "#/Intro/ms" resolve immediately on a
// fresh page load.
const INTRO_SET: DatSet = {
  id: "Intro",
  name: "Intro (default)",
  url: `${import.meta.env.BASE_URL}intro.dat`,
};

async function fetchAvailableSets(): Promise<DatSet[]> {
  const res = await fetch(CC1_SETS_INDEX_URL);
  if (!res.ok) throw new Error(`Failed to load set list (HTTP ${res.status})`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const sets: DatSet[] = [];
  for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href") ?? "";
    if (!/\.dat$/i.test(href)) continue;
    const url = new URL(href, CC1_SETS_INDEX_URL).toString();
    const name = decodeURIComponent(href).replace(/\.dat$/i, "");
    sets.push({ id: name, name, url });
  }
  sets.sort((a, b) => a.name.localeCompare(b.name));
  return sets;
}

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
const prevKeysDrawn: (boolean | null)[] = [null, null, null, null];
const prevBootsDrawn: (boolean | null)[] = [null, null, null, null];

let levels: GameSetup[] = [];
let game: Game | null = null;
let tickHandle: number | undefined;
let tileset: Tileset | null = null;
const sound = new SoundManager(import.meta.env.BASE_URL);
// The level timer/tick loop shouldn't run until the player makes their
// first move (matches Tile World's behavior of not starting the clock
// on level load).
let gameStarted = false;

// Populated once at startup (or left as just [INTRO_SET] if the network
// fetch fails) and reused both to render the sets page and to resolve a
// setId parsed out of the URL hash back into a downloadable .dat URL.
let availableSets: DatSet[] = [INTRO_SET];
let currentRulesetSlug: RulesetSlug = "ms";

function ensureStarted(): void {
  sound.resume();
  if (gameStarted || !game) return;
  gameStarted = true;
  tickHandle = window.setInterval(tick, 1000 / TICKS_PER_SECOND);
}

function stopGame(): void {
  if (tickHandle !== undefined) {
    clearInterval(tickHandle);
    tickHandle = undefined;
  }
  gameStarted = false;
  heldDirs.clear();
  touchDirs.clear();
}

const KEY_TO_DIR: Record<string, number> = {
  ArrowUp: NORTH,
  ArrowLeft: WEST,
  ArrowDown: SOUTH,
  ArrowRight: EAST,
};
const heldDirs = new Set<number>();

window.addEventListener("keydown", (e) => {
  const dir = KEY_TO_DIR[e.key];
  if (dir !== undefined) {
    e.preventDefault();
    heldDirs.add(dir);
    ensureStarted();
  }
});
window.addEventListener("keyup", (e) => {
  const dir = KEY_TO_DIR[e.key];
  if (dir !== undefined) heldDirs.delete(dir);
});

// Mobile touch controls: the board is divided into four triangular zones
// by its two diagonals (like a D-pad), so tapping/holding near the top,
// bottom, left, or right edge of the canvas moves in that direction.
// Multiple simultaneous touches are tracked by identifier so each one can
// be released independently.
const touchDirs = new Map<number, number>();

function directionForTouch(touch: Touch): number {
  const rect = canvas.getBoundingClientRect();
  const dx = touch.clientX - (rect.left + rect.width / 2);
  const dy = touch.clientY - (rect.top + rect.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? EAST : WEST;
  }
  return dy > 0 ? SOUTH : NORTH;
}

function handleTouchStartOrMove(e: TouchEvent): void {
  e.preventDefault();
  for (const touch of Array.from(e.changedTouches)) {
    touchDirs.set(touch.identifier, directionForTouch(touch));
  }
  ensureStarted();
}
function handleTouchEnd(e: TouchEvent): void {
  e.preventDefault();
  for (const touch of Array.from(e.changedTouches)) {
    touchDirs.delete(touch.identifier);
  }
}
canvas.addEventListener("touchstart", handleTouchStartOrMove, { passive: false });
canvas.addEventListener("touchmove", handleTouchStartOrMove, { passive: false });
canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
canvas.addEventListener("touchcancel", handleTouchEnd, { passive: false });

function currentInputCommand(): number {
  let dir = NIL;
  for (const d of heldDirs) dir |= d;
  for (const d of touchDirs.values()) dir |= d;
  return dir;
}

function currentRuleset(): number {
  return currentRulesetSlug === "ms" ? Ruleset.MS : Ruleset.Lynx;
}

function startLevel(index: number): void {
  stopGame();
  sound.reset();
  statusEl.textContent = "";
  statusEl.className = "status";

  const setup = levels[index];
  if (!setup) return;
  game = new Game(setup, currentRuleset());
  levelNameEl.textContent = `#${setup.number} ${setup.name || "(untitled)"}`;
  levelPasswordEl.textContent = setup.passwd ? `Password: ${setup.passwd}` : "";

  const bestSoFar = getBestTime(setup.number, currentRuleset());
  bestTimeEl.textContent = bestSoFar === null ? "—" : `${bestSoFar}s`;

  render();
}

function tick(): void {
  if (!game) return;
  const result = game.doTurn(currentInputCommand());
  sound.update(game.getSoundEffects(), currentRuleset());
  render();

  if (result !== 0) {
    if (tickHandle !== undefined) {
      clearInterval(tickHandle);
      tickHandle = undefined;
    }
    sound.stopLoops();
    statusEl.textContent = result > 0 ? "You win!" : "You lose.";
    statusEl.className = `status ${result > 0 ? "win" : "lose"} status-pop`;
    if (result > 0 && game) {
      const setup = levels[Number(levelSelect.value)];
      if (setup) {
        const seconds = game.secondsPlayed();
        if (recordTime(setup.number, currentRuleset(), seconds)) {
          bestTimeEl.textContent = `${seconds}s`;
        }
      }
    }
  }
}

function render(): void {
  if (!game || !tileset) return;
  const state = game.state;

  // xviewpos/yviewpos are Chip's raw map position in eighths-of-a-tile
  // units (ported directly from the engine's own prepareDisplay logic),
  // updated continuously by the engine during movement. computeViewport
  // uses them directly so the traditional view scrolls smoothly instead
  // of snapping a full tile at a time. The view is always 9x9
  // ("traditional") now — there's no view-size picker anymore.
  const viewport = computeViewport("traditional", state.xviewpos, state.yviewpos);
  const cellSize = CELL_SIZES.traditional;

  // The canvas is always sized to exactly the visible 9x9 window; the
  // viewport itself may be one tile wider/taller than that to supply a
  // scroll buffer (see computeViewport), which the canvas clips off.
  canvas.width = TRADITIONAL_SIZE * cellSize;
  canvas.height = TRADITIONAL_SIZE * cellSize;
  ctx.imageSmoothingEnabled = false;

  drawBoard(ctx, tileset, state.map, viewport, cellSize);
  // getCreatures() now returns real per-tick data under both rulesets
  // (tworld-engine's MsLogic.activeCreatures() is a passthrough of
  // state.creatures, mirroring Lynx). MS bakes Chip's sprite directly into
  // the map cell every tick, including swapping in the drowned/burned/
  // exited sprite once chipstatus reflects it (see tworld-engine's
  // updateCreature) — so drawBoard above already shows the right thing at
  // Chip's tile. But the creature list still carries Chip as a live,
  // non-hidden entry with his bare directional sprite, since MS never
  // marks him hidden on death the way Lynx does. Drawing him again here
  // would paint that plain sprite right over the correctly-baked death
  // tile, hiding it. 0 = CHIP_OKAY, 6 = CHIP_SQUISHED (not yet a loss) —
  // anything else means Chip is dead and should be left to the map tile
  // alone.
  const creatures = game.getCreatures();
  const msChipIsDead =
    state.ruleset === Ruleset.MS && state.msstate.chipstatus !== 0 && state.msstate.chipstatus !== 6;
  drawCreatureOverlay(
    ctx,
    tileset,
    msChipIsDead ? creatures.filter((cr) => cr.id !== Tile.Chip) : creatures,
    viewport,
    cellSize,
  );

  chipsNeededEl.textContent = String(state.chipsneeded);
  const secondsLeft = state.timelimit
    ? Math.max(0, Math.ceil((state.timelimit - state.currenttime) / TICKS_PER_SECOND))
    : Infinity;
  timeLeftEl.textContent = state.timelimit ? String(secondsLeft) : "∞";
  for (let n = 0; n < 4; n++) {
    const hasKey = Boolean(state.keys[n]);
    if (hasKey !== prevKeysDrawn[n]) {
      keyIconCtxs[n]!.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
      drawTile(keyIconCtxs[n]!, tileset, hasKey ? KEY_TILES[n]! : Tile.Empty, 0, 0, ICON_SIZE);
      prevKeysDrawn[n] = hasKey;
    }
    const hasBoot = Boolean(state.boots[n]);
    if (hasBoot !== prevBootsDrawn[n]) {
      bootIconCtxs[n]!.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
      drawTile(bootIconCtxs[n]!, tileset, hasBoot ? BOOT_TILES[n]! : Tile.Empty, 0, 0, ICON_SIZE);
      prevBootsDrawn[n] = hasBoot;
    }
  }

  const showHint = (state.statusflags & SF_SHOWHINT) !== 0;
  hintPanelEl.classList.toggle("visible", showHint);
  hintPanelEl.textContent = showHint ? state.hinttext : "";
}

async function loadSet(url: string): Promise<void> {
  levelSelect.disabled = true;
  setStatusEl.textContent = "Loading set…";
  setStatusEl.className = "set-status";

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    levels = splitDatFile(bytes).levels;

    levelSelect.innerHTML = "";
    levels.forEach((level, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `#${level.number} ${level.name || "(untitled)"}`;
      levelSelect.appendChild(opt);
    });

    setStatusEl.textContent = "";
    startLevel(0);
  } catch (err) {
    setStatusEl.textContent = `Failed to load set: ${(err as Error).message}`;
    setStatusEl.className = "set-status error";
  } finally {
    levelSelect.disabled = false;
  }
}

function renderSetsList(): void {
  setsListEl.innerHTML = "";
  for (const set of availableSets) {
    const row = document.createElement("li");
    row.className = "set-row";

    const nameEl = document.createElement("span");
    nameEl.className = "set-name";
    nameEl.textContent = set.name;
    row.appendChild(nameEl);

    const actions = document.createElement("div");
    actions.className = "set-actions";
    for (const ruleset of ["ms", "lynx"] as const) {
      const btn = document.createElement("button");
      btn.textContent = ruleset === "ms" ? "MS" : "Lynx";
      btn.addEventListener("click", () => {
        location.hash = buildHash(set.id, ruleset);
      });
      actions.appendChild(btn);
    }
    row.appendChild(actions);

    setsListEl.appendChild(row);
  }
}

async function refreshAvailableSets(): Promise<void> {
  try {
    const sets = await fetchAvailableSets();
    availableSets = [INTRO_SET, ...sets];
    setsStatusEl.textContent = "";
    setsStatusEl.className = "set-status";
  } catch (err) {
    console.error("Failed to load CC1 set list", err);
    setsStatusEl.textContent = `Couldn't load the set list from bitbusters.club: ${(err as Error).message}`;
    setsStatusEl.className = "set-status error";
  }
  renderSetsList();
}

function showSetsPage(): void {
  stopGame();
  gamePageEl.classList.add("hidden");
  setsPageEl.classList.remove("hidden");
}

async function showGamePage(setId: string, ruleset: RulesetSlug): Promise<void> {
  setsPageEl.classList.add("hidden");
  gamePageEl.classList.remove("hidden");
  currentRulesetSlug = ruleset;
  rulesetReadoutEl.textContent = ruleset === "ms" ? "Ruleset: MS" : "Ruleset: Lynx";

  const set = availableSets.find((s) => s.id === setId);
  if (!set) {
    setStatusEl.textContent = `Unknown set: ${setId}`;
    setStatusEl.className = "set-status error";
    return;
  }
  await loadSet(set.url);
}

function handleRouteChange(): void {
  const route = parseHash(location.hash);
  if (route) {
    showGamePage(route.setId, route.ruleset);
  } else {
    showSetsPage();
  }
}

async function main(): Promise<void> {
  tileset = await loadTileset(`${import.meta.env.BASE_URL}tiles.bmp`);
  sound.preload();

  levelSelect.addEventListener("change", () => startLevel(Number(levelSelect.value)));
  restartBtn.addEventListener("click", () => startLevel(Number(levelSelect.value)));
  backToSetsBtn.addEventListener("click", () => {
    location.hash = "";
  });
  window.addEventListener("hashchange", handleRouteChange);

  await refreshAvailableSets();
  handleRouteChange();
}

main().catch((err) => {
  console.error(err);
  statusEl.textContent = `Failed to load: ${(err as Error).message}`;
  statusEl.className = "status lose";
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual walkthrough on the dev server**

Run: `npm run dev`, open the printed local URL in a browser.

Verify each of the following:
1. The page loads on the sets page (`#sets-page` visible, `#game-page` hidden), URL hash is empty. "Intro (default)" appears in the list immediately; other CC1 sets appear shortly after (network fetch).
2. Click "MS" next to "Intro (default)". URL becomes `.../#/Intro/ms`, the game page appears, Intro's first level loads, "Ruleset: MS" is shown, and the board renders as a 9x9 window (not the full 32x32 map).
3. Arrow keys move Chip; the level plays normally.
4. Click "← Sets". URL hash clears, sets page reappears, the running game's timer stops (confirm by checking no console errors and that returning to the game later resumes from the same level rather than a stuck timer).
5. Reload the browser directly at the `.../#/Intro/ms` URL from step 2 (paste it fresh, hit enter). Confirm it lands directly on the game page for Intro/MS without ever showing the sets page — this is the "come back to it later" bookmark case.
6. Pick any network-loaded set (e.g. whatever appears alphabetically first that isn't Intro) with "Lynx". Confirm the URL hash encodes that set's name and `lynx`, and "Ruleset: Lynx" is displayed.
7. Confirm there is no password input, no "Go" button, and no password error text anywhere in the UI.
8. Confirm there is no "View" dropdown anywhere, and the board is always the 9x9 traditional size.
9. Confirm there is no "Fullscreen" button anywhere.
10. Confirm the Level dropdown still works to switch levels within the currently loaded set, and Restart still restarts the current level.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: replace toolbar controls with sets page and hash routing"
```

---
