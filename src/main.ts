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
