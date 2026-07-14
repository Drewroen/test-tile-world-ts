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
import { drawBoard, drawCreatureOverlay, computeViewport, CELL_SIZES, TRADITIONAL_SIZE, type ViewportMode } from "./render";
import { loadTileset, drawTile, type Tileset } from "./tileset";

// The engine advances 20 ticks per (game) second — a fixed invariant of the
// original C source (gen.h's TICKS_PER_SECOND), not part of the public API
// since a host only needs to drive doTurn() at this cadence, not read the
// constant back.
const TICKS_PER_SECOND = 20;

const canvas = document.querySelector<HTMLCanvasElement>("#board")!;
const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;

const setSelect = document.querySelector<HTMLSelectElement>("#set-select")!;
const levelSelect = document.querySelector<HTMLSelectElement>("#level-select")!;
const rulesetSelect = document.querySelector<HTMLSelectElement>("#ruleset-select")!;
const viewportSelect = document.querySelector<HTMLSelectElement>("#viewport-select")!;
const restartBtn = document.querySelector<HTMLButtonElement>("#restart-btn")!;
const levelNameEl = document.querySelector<HTMLElement>("#level-name")!;
const levelPasswordEl = document.querySelector<HTMLElement>("#level-password")!;
const chipsNeededEl = document.querySelector<HTMLElement>("#chips-needed")!;
const timeLeftEl = document.querySelector<HTMLElement>("#time-left")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const setStatusEl = document.querySelector<HTMLElement>("#set-status")!;

// Gliderbot's public mirror of the official CC1 level sets. It's a plain
// directory listing (Apache/nginx autoindex), so the set list is scraped
// by pulling out every <a href> that points at a .dat file rather than
// relying on any particular page layout.
const CC1_SETS_INDEX_URL = "https://bitbusters.club/gliderbot/sets/cc1/";

interface DatSet {
  name: string;
  url: string;
}

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
    sets.push({ name, url });
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
// The level timer/tick loop shouldn't run until the player makes their
// first move (matches Tile World's behavior of not starting the clock
// on level load).
let gameStarted = false;

function ensureStarted(): void {
  if (gameStarted || !game) return;
  gameStarted = true;
  tickHandle = window.setInterval(tick, 1000 / TICKS_PER_SECOND);
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
  return rulesetSelect.value === "ms" ? Ruleset.MS : Ruleset.Lynx;
}

function currentViewportMode(): ViewportMode {
  return viewportSelect.value === "traditional" ? "traditional" : "full";
}

function startLevel(index: number): void {
  if (tickHandle !== undefined) {
    clearInterval(tickHandle);
    tickHandle = undefined;
  }
  heldDirs.clear();
  touchDirs.clear();
  gameStarted = false;
  statusEl.textContent = "";
  statusEl.className = "status";

  const setup = levels[index];
  if (!setup) return;
  game = new Game(setup, currentRuleset());
  levelNameEl.textContent = `#${setup.number} ${setup.name || "(untitled)"}`;
  levelPasswordEl.textContent = setup.passwd ? `Password: ${setup.passwd}` : "";

  render();
}

function tick(): void {
  if (!game) return;
  const result = game.doTurn(currentInputCommand());
  render();

  if (result !== 0) {
    if (tickHandle !== undefined) {
      clearInterval(tickHandle);
      tickHandle = undefined;
    }
    statusEl.textContent = result > 0 ? "You win!" : "You lose.";
    statusEl.className = `status ${result > 0 ? "win" : "lose"}`;
  }
}

function render(): void {
  if (!game || !tileset) return;
  const state = game.state;

  // xviewpos/yviewpos are Chip's raw map position in eighths-of-a-tile
  // units (ported directly from the engine's own prepareDisplay logic),
  // updated continuously by the engine during movement. computeViewport
  // uses them directly so the traditional view scrolls smoothly instead
  // of snapping a full tile at a time.
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
  ctx.imageSmoothingEnabled = false;

  drawBoard(ctx, tileset, state.map, viewport, cellSize);
  // getCreatures() only has data for rulesets whose logic tracks an active
  // creature list (Lynx); MS's logic doesn't expose one, so it always
  // returns []. Chip himself is always state.creatures[0] regardless of
  // ruleset, so fall back to that to keep the player visible under MS.
  const creatures = game.getCreatures();
  drawCreatureOverlay(
    ctx,
    tileset,
    creatures.length > 0 ? creatures : [state.creatures[0]],
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
}

async function loadSet(url: string): Promise<void> {
  setSelect.disabled = true;
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
    setSelect.disabled = false;
    levelSelect.disabled = false;
  }
}

async function main(): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const defaultSetUrl = `${base}intro.dat`;
  tileset = await loadTileset(`${base}tiles.bmp`);

  levelSelect.addEventListener("change", () => startLevel(Number(levelSelect.value)));
  rulesetSelect.addEventListener("change", () => startLevel(Number(levelSelect.value)));
  viewportSelect.addEventListener("change", render);
  restartBtn.addEventListener("click", () => startLevel(Number(levelSelect.value)));
  setSelect.addEventListener("change", () => loadSet(setSelect.value || defaultSetUrl));

  await loadSet(defaultSetUrl);

  // Populate the set picker with the CC1 sets mirrored at bitbusters.club in
  // the background; the default intro.dat is already playable above.
  try {
    const sets = await fetchAvailableSets();
    for (const set of sets) {
      const opt = document.createElement("option");
      opt.value = set.url;
      opt.textContent = set.name;
      setSelect.appendChild(opt);
    }
  } catch (err) {
    console.error("Failed to load CC1 set list", err);
    setStatusEl.textContent = `Couldn't load the set list from bitbusters.club: ${(err as Error).message}`;
    setStatusEl.className = "set-status error";
  }
}

main().catch((err) => {
  console.error(err);
  statusEl.textContent = `Failed to load: ${(err as Error).message}`;
  statusEl.className = "status lose";
});
