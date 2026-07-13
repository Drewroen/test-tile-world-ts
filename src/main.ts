import {
  Game,
  splitDatFile,
  Ruleset,
  NIL,
  NORTH,
  WEST,
  SOUTH,
  EAST,
  type GameSetup,
} from "tworld-engine";
import { drawBoard, drawCreatureOverlay, computeViewport, CELL_SIZES, TRADITIONAL_SIZE, type ViewportMode } from "./render";
import { loadTileset, type Tileset } from "./tileset";

// The engine advances 20 ticks per (game) second — a fixed invariant of the
// original C source (gen.h's TICKS_PER_SECOND), not part of the public API
// since a host only needs to drive doTurn() at this cadence, not read the
// constant back.
const TICKS_PER_SECOND = 20;

const canvas = document.querySelector<HTMLCanvasElement>("#board")!;
const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;

const levelSelect = document.querySelector<HTMLSelectElement>("#level-select")!;
const rulesetSelect = document.querySelector<HTMLSelectElement>("#ruleset-select")!;
const viewportSelect = document.querySelector<HTMLSelectElement>("#viewport-select")!;
const restartBtn = document.querySelector<HTMLButtonElement>("#restart-btn")!;
const levelNameEl = document.querySelector<HTMLElement>("#level-name")!;
const chipsNeededEl = document.querySelector<HTMLElement>("#chips-needed")!;
const timeLeftEl = document.querySelector<HTMLElement>("#time-left")!;
const keysEl = document.querySelector<HTMLElement>("#keys")!;
const bootsEl = document.querySelector<HTMLElement>("#boots")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;

let levels: GameSetup[] = [];
let game: Game | null = null;
let tickHandle: number | undefined;
let tileset: Tileset | null = null;

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
  statusEl.textContent = "";
  statusEl.className = "status";

  const setup = levels[index];
  if (!setup) return;
  game = new Game(setup, currentRuleset());
  levelNameEl.textContent = `#${setup.number} ${setup.name || "(untitled)"}`;

  tickHandle = window.setInterval(tick, 1000 / TICKS_PER_SECOND);
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
  drawCreatureOverlay(ctx, tileset, game.getCreatures(), viewport, cellSize);

  chipsNeededEl.textContent = String(state.chipsneeded);
  const secondsLeft = state.timelimit
    ? Math.max(0, Math.ceil((state.timelimit - state.currenttime) / TICKS_PER_SECOND))
    : Infinity;
  timeLeftEl.textContent = state.timelimit ? String(secondsLeft) : "∞";
  keysEl.textContent = `R:${state.keys[0]} B:${state.keys[1]} Y:${state.keys[2]} G:${state.keys[3]}`;
  bootsEl.textContent = `Ice:${state.boots[0]} Slide:${state.boots[1]} Fire:${state.boots[2]} Water:${state.boots[3]}`;
}

async function main(): Promise<void> {
  const base = import.meta.env.BASE_URL;
  tileset = await loadTileset(`${base}tiles.bmp`);

  const res = await fetch(`${base}intro.dat`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const parsed = splitDatFile(bytes);
  levels = parsed.levels;

  levelSelect.innerHTML = "";
  levels.forEach((level, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `#${level.number} ${level.name || "(untitled)"}`;
    levelSelect.appendChild(opt);
  });

  levelSelect.addEventListener("change", () => startLevel(Number(levelSelect.value)));
  rulesetSelect.addEventListener("change", () => startLevel(Number(levelSelect.value)));
  viewportSelect.addEventListener("change", render);
  restartBtn.addEventListener("click", () => startLevel(Number(levelSelect.value)));

  startLevel(0);
}

main().catch((err) => {
  console.error(err);
  statusEl.textContent = `Failed to load: ${(err as Error).message}`;
  statusEl.className = "status lose";
});
