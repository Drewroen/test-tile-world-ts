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
import {
  CURATED_SETS,
  INTRO_SET,
  datUrl,
  parseSetsSnapshot,
  searchSets,
  type SetEntry,
} from "./sets";
import {
  completedLevels,
  getLastPlayed,
  hasSeenHowTo,
  markCompleted,
  markHowToSeen,
  saveLastPlayed,
} from "./progress";
import { parseHash, buildHash, type Route, type RulesetSlug } from "./routing";

// The engine advances 20 ticks per (game) second — a fixed invariant of the
// original C source (gen.h's TICKS_PER_SECOND), not part of the public API
// since a host only needs to drive doTurn() at this cadence, not read the
// constant back.
const TICKS_PER_SECOND = 20;

// The catalogue holds ~1,100 sets; rendering all of them as DOM rows is what
// made the old landing page unusable, so results are capped and the "showing N
// of M" line tells the player to keep typing.
const SEARCH_RESULT_LIMIT = 40;

const canvas = document.querySelector<HTMLCanvasElement>("#board")!;
const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;

const setsPageEl = document.querySelector<HTMLDivElement>("#sets-page")!;
const gamePageEl = document.querySelector<HTMLDivElement>("#game-page")!;
const curatedListEl = document.querySelector<HTMLUListElement>("#curated-list")!;
const continueSectionEl = document.querySelector<HTMLElement>("#continue-section")!;
const continueCardEl = document.querySelector<HTMLElement>("#continue-card")!;
const setsCountEl = document.querySelector<HTMLElement>("#sets-count")!;
const searchInput = document.querySelector<HTMLInputElement>("#sets-search")!;
const setsListEl = document.querySelector<HTMLUListElement>("#sets-list")!;
const setsMoreEl = document.querySelector<HTMLElement>("#sets-more")!;
const setsStatusEl = document.querySelector<HTMLElement>("#sets-status")!;
const quickPlayBtn = document.querySelector<HTMLButtonElement>("#quick-play-btn")!;
const quickPlayCc1Btn = document.querySelector<HTMLButtonElement>("#quick-play-cc1-btn")!;
const backToSetsBtn = document.querySelector<HTMLButtonElement>("#back-to-sets-btn")!;

const levelSelect = document.querySelector<HTMLSelectElement>("#level-select")!;
const restartBtn = document.querySelector<HTMLButtonElement>("#restart-btn")!;
const rulesetToggleBtn = document.querySelector<HTMLButtonElement>("#ruleset-toggle")!;
const copyLinkBtn = document.querySelector<HTMLButtonElement>("#copy-link-btn")!;
const setNameEl = document.querySelector<HTMLElement>("#set-name")!;
const levelNameEl = document.querySelector<HTMLElement>("#level-name")!;
const levelPasswordEl = document.querySelector<HTMLElement>("#level-password")!;
const chipsNeededEl = document.querySelector<HTMLElement>("#chips-needed")!;
const timeLeftEl = document.querySelector<HTMLElement>("#time-left")!;
const bestTimeEl = document.querySelector<HTMLElement>("#best-time")!;
const timeBarEl = document.querySelector<HTMLElement>("#time-bar")!;
const timeBarFillEl = document.querySelector<HTMLElement>("#time-bar-fill")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const hintPanelEl = document.querySelector<HTMLElement>("#hint-panel")!;
const setStatusEl = document.querySelector<HTMLElement>("#set-status")!;
const howtoOverlayEl = document.querySelector<HTMLElement>("#howto-overlay")!;
const howtoDismissBtn = document.querySelector<HTMLButtonElement>("#howto-dismiss")!;

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
// The clock bar only needs touching when its whole-number percentage changes.
let lastBarPercent = -1;

let levels: GameSetup[] = [];
// Catalogue id of the set whose .dat is currently in `levels` (e.g. "CCLP1"),
// and the URL it was fetched from — the latter is what best times and
// completion marks are keyed by, since the same level number can appear in
// different sets (see besttime.ts).
let loadedSetId: string | null = null;
let currentSetUrl = "";
let currentLevelNumber: number | null = null;
let game: Game | null = null;
let tickHandle: number | undefined;
let tileset: Tileset | null = null;
const sound = new SoundManager(import.meta.env.BASE_URL);
// The level timer/tick loop shouldn't run until the player makes their
// first move (matches Tile World's behavior of not starting the clock
// on level load).
let gameStarted = false;

// Populated from the shipped snapshot (public/sets.json) at startup; until it
// arrives, only the bundled Intro set is listed.
let availableSets: SetEntry[] = [];
let catalogueLoaded = false;
let currentRulesetSlug: RulesetSlug = "ms";

// Guard for overlapping set loads: clicking two sets in quick succession used
// to be able to finish the first fetch last and start a level from the wrong
// set.
let loadToken = 0;

// A set's .dat. Only the Intro set is bundled; everything else is fetched from
// bitbusters.club. The catalogue is *not* consulted — a deep link to any set id
// works even before (or without) the snapshot, and a genuinely unknown id
// surfaces as a failed fetch rather than a silent dead end.
function setUrlFor(setId: string): string {
  return setId === INTRO_SET.id ? `${import.meta.env.BASE_URL}intro.dat` : datUrl(setId);
}

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

// Arrow keys plus WASD, which most players reach for first.
const KEY_TO_DIR: Record<string, number> = {
  arrowup: NORTH,
  arrowleft: WEST,
  arrowdown: SOUTH,
  arrowright: EAST,
  w: NORTH,
  a: WEST,
  s: SOUTH,
  d: EAST,
};
const heldDirs = new Set<number>();

// Keystrokes belong to the game only when they aren't aimed at a control: the
// landing page has a search box, and an "r" typed into it must not restart a
// level in a hidden page behind it.
function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "SELECT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  );
}

window.addEventListener("keydown", (e) => {
  if (isTextEntryTarget(e.target)) return;
  const key = e.key.toLowerCase();
  const dir = KEY_TO_DIR[key];
  if (dir !== undefined) {
    e.preventDefault();
    heldDirs.add(dir);
    ensureStarted();
    return;
  }
  if (key === "r" && !gamePageEl.classList.contains("hidden")) {
    e.preventDefault();
    restartCurrentLevel();
  }
});
window.addEventListener("keyup", (e) => {
  const dir = KEY_TO_DIR[e.key.toLowerCase()];
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

// The URL always names the level being played, so "copy link" and the address
// bar are both shareable deep links. replaceState (not a hash assignment)
// keeps level changes out of the history stack — the back button stays a way
// back to the set list rather than a level-by-level rewind.
function syncHash(): void {
  if (currentLevelNumber === null) return;
  history.replaceState(null, "", buildHash(loadedSetId ?? "", currentRulesetSlug, currentLevelNumber));
}

// CC1 .dat level names are NUL-terminated, and the engine hands the name back
// verbatim — so "#1 KEYS AND CHIPS\u0000" is what the picker would otherwise
// display and what "copy level link" deep links would carry. Trim control
// characters for display only.
function levelDisplayName(level: GameSetup): string {
  // eslint-disable-next-line no-control-regex
  return level.name.replace(/[\u0000-\u001f\u007f]+/g, "").trim();
}

function levelLabel(level: GameSetup): string {
  return `#${level.number} ${levelDisplayName(level) || "(untitled)"}`;
}

function startLevel(index: number): void {
  stopGame();
  sound.reset();
  statusEl.textContent = "";
  statusEl.className = "status";

  const setup = levels[index];
  if (!setup) return;
  game = new Game(setup, currentRuleset());
  currentLevelNumber = setup.number;
  levelSelect.value = String(setup.number);
  levelNameEl.textContent = levelLabel(setup);
  levelPasswordEl.textContent = setup.passwd ? `Password: ${setup.passwd}` : "";

  const bestSoFar = getBestTime(currentSetUrl, setup.number, currentRuleset());
  bestTimeEl.textContent = bestSoFar === null ? "—" : `${bestSoFar}s`;

  if (loadedSetId) {
    saveLastPlayed(localStorage, {
      setId: loadedSetId,
      ruleset: currentRulesetSlug,
      levelNumber: setup.number,
      levelName: levelDisplayName(setup),
    });
  }
  syncHash();
  render();
}

function levelIndexForNumber(levelNumber: number): number {
  const index = levels.findIndex((level) => level.number === levelNumber);
  return index >= 0 ? index : 0;
}

function startLevelByNumber(levelNumber: number): void {
  startLevel(levelIndexForNumber(levelNumber));
}

function restartCurrentLevel(): void {
  startLevelByNumber(currentLevelNumber ?? levels[0]?.number ?? 1);
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
    if (result > 0 && game && currentLevelNumber !== null) {
      const state = game.state;
      const hasTimeLimit = Boolean(state.timelimit);
      const seconds = hasTimeLimit
        ? Math.max(0, Math.ceil((state.timelimit - state.currenttime) / TICKS_PER_SECOND))
        : game.secondsPlayed();
      // Completion is recorded separately from best times: a win that doesn't
      // improve the best time still counts as progress on the landing page.
      markCompleted(localStorage, currentSetUrl, currentLevelNumber, currentRuleset());
      if (recordTime(currentSetUrl, currentLevelNumber, currentRuleset(), seconds, hasTimeLimit)) {
        bestTimeEl.textContent = `${seconds}s`;
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
  // The clock bar is the app's TWProgressBar: the share of the time limit still
  // on the clock, turning its pre-par red for the last quarter. A level with no
  // time limit has nothing to run down, so the bar sits full and green.
  const remaining = state.timelimit
    ? Math.max(0, state.timelimit - state.currenttime) / state.timelimit
    : 1;
  timeBarEl.classList.toggle("unlimited", !state.timelimit);
  timeBarEl.classList.toggle("low", Boolean(state.timelimit) && remaining <= 0.25);
  const percent = Math.round(remaining * 100);
  if (percent !== lastBarPercent) {
    timeBarFillEl.style.width = `${percent}%`;
    lastBarPercent = percent;
  }
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

// ---------------------------------------------------------------------------
// Landing page
// ---------------------------------------------------------------------------

function playButton(setId: string, ruleset: RulesetSlug, label = "Play"): HTMLButtonElement {
  const btn = document.createElement("button");
  // MS is the default path, so it gets the filled button; Lynx stays a quieter
  // outline (Bootstrap's own hierarchy, in the site's colors).
  btn.className = ruleset === "ms" ? "btn btn-primary" : "btn btn-outline-secondary";
  btn.textContent = label;
  btn.title = `Play ${setId} with ${ruleset === "ms" ? "MS" : "Lynx"} rules`;
  btn.addEventListener("click", () => {
    location.hash = buildHash(setId, ruleset);
  });
  return btn;
}

function renderCurated(): void {
  curatedListEl.innerHTML = "";
  for (const set of CURATED_SETS) {
    const card = document.createElement("li");
    card.className = "curated-card";

    const title = document.createElement("div");
    title.className = "curated-title";
    title.textContent = set.label;
    card.appendChild(title);

    const blurb = document.createElement("div");
    blurb.className = "curated-blurb";
    blurb.textContent = set.blurb;
    card.appendChild(blurb);

    const completed = completedLevels(localStorage, setUrlFor(set.id));
    if (completed.size > 0) {
      const progress = document.createElement("div");
      progress.className = "curated-progress";
      progress.textContent = `${completed.size} level${completed.size === 1 ? "" : "s"} beaten`;
      card.appendChild(progress);
    }

    const actions = document.createElement("div");
    actions.className = "curated-actions";
    actions.appendChild(playButton(set.id, "ms"));
    actions.appendChild(playButton(set.id, "lynx", "Lynx"));
    card.appendChild(actions);

    curatedListEl.appendChild(card);
  }
}

function renderContinue(): void {
  const last = getLastPlayed(localStorage);
  if (!last) {
    continueSectionEl.classList.add("hidden");
    continueCardEl.innerHTML = "";
    return;
  }
  continueSectionEl.classList.remove("hidden");
  continueCardEl.innerHTML = "";

  const detail = document.createElement("div");
  detail.className = "continue-detail";
  detail.textContent = `${last.setId} · #${last.levelNumber}${
    last.levelName ? ` ${last.levelName}` : ""
  } · ${last.ruleset === "ms" ? "MS" : "Lynx"} rules`;
  continueCardEl.appendChild(detail);
  continueCardEl.appendChild(
    playButton(last.setId, last.ruleset, `Continue #${last.levelNumber}`),
  );
}

function renderSetResults(): void {
  const query = searchInput.value.trim();
  const { matches, total } = searchSets(availableSets, query, SEARCH_RESULT_LIMIT);

  setsListEl.innerHTML = "";
  for (const set of matches) {
    const row = document.createElement("li");
    row.className = "set-row";

    const nameEl = document.createElement("span");
    nameEl.className = "set-name";
    nameEl.textContent = set.name;
    row.appendChild(nameEl);

    const actions = document.createElement("div");
    actions.className = "set-actions";
    actions.appendChild(playButton(set.id, "ms"));
    actions.appendChild(playButton(set.id, "lynx", "Lynx"));
    row.appendChild(actions);

    setsListEl.appendChild(row);
  }

  if (!catalogueLoaded) {
    setsMoreEl.textContent = "";
    return;
  }
  if (total === 0) {
    setsMoreEl.textContent = query
      ? `No sets match "${query}".`
      : "The set catalogue is empty.";
    return;
  }
  if (total > matches.length) {
    setsMoreEl.textContent = query
      ? `Showing ${matches.length} of ${total} matching sets — keep typing to narrow it down.`
      : `Showing the first ${matches.length} of ${total.toLocaleString()} sets — search above to find a specific one.`;
    return;
  }
  setsMoreEl.textContent = query
    ? `${total} matching set${total === 1 ? "" : "s"}.`
    : `${total.toLocaleString()} sets.`;
}

function renderLanding(): void {
  renderContinue();
  renderCurated();
  renderSetResults();
}

function showSetsPage(): void {
  stopGame();
  game = null;
  currentLevelNumber = null;
  gamePageEl.classList.add("hidden");
  setsPageEl.classList.remove("hidden");
  document.title = "tworld-engine demo — play Chip's Challenge in the browser";
  closeHowTo();
  renderLanding();
}

function showGamePage(setId: string, ruleset: RulesetSlug): void {
  setsPageEl.classList.add("hidden");
  gamePageEl.classList.remove("hidden");
  setNameEl.textContent = `Set: ${setId}`;
  document.title = `${setId} — tworld-engine demo`;
}

// ---------------------------------------------------------------------------
// First-run how-to
// ---------------------------------------------------------------------------

function openHowTo(): void {
  howtoOverlayEl.classList.remove("hidden");
  howtoDismissBtn.focus();
}

function closeHowTo(): void {
  howtoOverlayEl.classList.add("hidden");
}

// Shown once per browser: the goal, the controls, and the fact that the clock
// deliberately waits for the first move (otherwise the stalled "Time" readout
// reads as a bug).
function maybeShowHowTo(): void {
  if (hasSeenHowTo(localStorage)) return;
  markHowToSeen(localStorage);
  openHowTo();
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

async function openSet(setId: string, ruleset: RulesetSlug, levelNumber: number | null): Promise<boolean> {
  const token = ++loadToken;
  const sameSet = setId === loadedSetId;

  currentRulesetSlug = ruleset;
  rulesetToggleBtn.textContent = `Ruleset: ${ruleset === "ms" ? "MS" : "Lynx"}`;

  if (!sameSet) {
    if (catalogueLoaded && setId !== INTRO_SET.id && !availableSets.some((s) => s.id === setId)) {
      setStatusEl.textContent = `Unknown set: ${setId}`;
      setStatusEl.className = "set-status error";
      return false;
    }
    if (!(await loadSet(setId, setUrlFor(setId), token))) return false;
  }

  // No level in the route means "wherever the player already is" for a set
  // that's already loaded, and the first level for a freshly loaded one.
  const target = levelNumber ?? currentLevelNumber ?? levels[0]?.number ?? 1;
  if (target !== currentLevelNumber || !game) startLevelByNumber(target);
  else syncHash();
  return game !== null;
}

async function loadSet(setId: string, url: string, token: number): Promise<boolean> {
  levelSelect.disabled = true;
  setStatusEl.textContent = "Loading set…";
  setStatusEl.className = "set-status";

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (token !== loadToken) return false;

    levels = splitDatFile(bytes).levels;
    loadedSetId = setId;
    currentSetUrl = url;
    currentLevelNumber = null;

    levelSelect.innerHTML = "";
    for (const level of levels) {
      const opt = document.createElement("option");
      opt.value = String(level.number);
      opt.textContent = levelLabel(level);
      levelSelect.appendChild(opt);
    }

    setStatusEl.textContent = "";
    return true;
  } catch (err) {
    if (token === loadToken) {
      setStatusEl.textContent = `Failed to load set: ${(err as Error).message}`;
      setStatusEl.className = "set-status error";
    }
    return false;
  } finally {
    if (token === loadToken) levelSelect.disabled = false;
  }
}

function currentRoute(): Route | null {
  return parseHash(location.hash);
}

function handleRouteChange(): void {
  const route = currentRoute();
  if (!route) {
    showSetsPage();
    return;
  }
  // Switch pages up front so the "Loading set…" line and any fetch error land
  // somewhere visible; the how-to card waits until a level is actually
  // running so it can't sit on top of an error message.
  showGamePage(route.setId, route.ruleset);
  void openSet(route.setId, route.ruleset, route.levelNumber).then((playing) => {
    if (playing) maybeShowHowTo();
  });
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

// The catalogue is a snapshot committed to the repo (public/sets.json, see
// scripts/fetch-sets-index.mjs) rather than a live scrape of bitbusters.club:
// the landing page used to depend on that host being up, same-origin-friendly
// and fast, and degraded to "Intro only" when it wasn't. Only the .dat a player
// actually picks is fetched at runtime now.
async function loadCatalogue(): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}sets.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    availableSets = parseSetsSnapshot(await res.json());
    catalogueLoaded = availableSets.length > 0;
    if (!catalogueLoaded) throw new Error("snapshot contains no sets");
    setsStatusEl.textContent = "";
    setsStatusEl.className = "set-status";
    setsCountEl.textContent = `${availableSets.length.toLocaleString()} available`;
  } catch (err) {
    console.error("Failed to load the set catalogue", err);
    availableSets = [INTRO_SET];
    setsCountEl.textContent = "";
    setsStatusEl.textContent =
      "Couldn't load the set catalogue — the bundled Intro set still works, and any set can be deep-linked by name.";
    setsStatusEl.className = "set-status error";
  }
  renderSetResults();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  tileset = await loadTileset(`${import.meta.env.BASE_URL}tiles.bmp`);
  sound.preload();

  levelSelect.addEventListener("change", () => startLevelByNumber(Number(levelSelect.value)));
  restartBtn.addEventListener("click", restartCurrentLevel);
  quickPlayBtn.addEventListener("click", () => {
    location.hash = buildHash(INTRO_SET.id, "ms");
  });
  quickPlayCc1Btn.addEventListener("click", () => {
    location.hash = buildHash("CC1", "ms");
  });
  rulesetToggleBtn.addEventListener("click", () => {
    // The engine takes its ruleset when the Game is constructed, so switching
    // means rebuilding the current level under the other ruleset.
    currentRulesetSlug = currentRulesetSlug === "ms" ? "lynx" : "ms";
    rulesetToggleBtn.textContent = `Ruleset: ${currentRulesetSlug === "ms" ? "MS" : "Lynx"}`;
    restartCurrentLevel();
  });
  copyLinkBtn.addEventListener("click", () => {
    void copyLevelLink();
  });
  backToSetsBtn.addEventListener("click", () => {
    // pushState rather than an empty hash assignment: it leaves a real history
    // entry, so the browser's back button returns to the level that was
    // playing instead of an empty "#".
    history.pushState(null, "", location.pathname + location.search);
    showSetsPage();
  });
  searchInput.addEventListener("input", renderSetResults);
  howtoDismissBtn.addEventListener("click", closeHowTo);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeHowTo();
  });
  window.addEventListener("hashchange", handleRouteChange);

  // Render the landing page and resolve the initial route before the
  // catalogue arrives: the Intro set needs no network access, and every other
  // set resolves from its id alone, so nothing on the critical path waits on
  // the snapshot.
  renderLanding();
  handleRouteChange();

  await loadCatalogue();
  renderLanding();
}

async function copyLevelLink(): Promise<void> {
  syncHash();
  const url = location.href;
  if (await writeClipboard(url)) {
    flashCopyLabel("Copied!");
    return;
  }
  // Clipboard access is denied outside a secure context (and in some embedded
  // browsers). Rather than a dead button, surface the URL itself, selected, so
  // Ctrl/Cmd+C still gets the player a shareable link.
  flashCopyLabel("Copy failed — press Ctrl+C");
  revealLinkForManualCopy(url);
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and non-secure origins only have the legacy path.
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(field);
    return ok;
  }
}

function flashCopyLabel(text: string): void {
  copyLinkBtn.textContent = text;
  window.setTimeout(() => {
    copyLinkBtn.textContent = "Copy level link";
  }, 1500);
}

let manualLinkEl: HTMLInputElement | null = null;

function revealLinkForManualCopy(url: string): void {
  if (!manualLinkEl) {
    manualLinkEl = document.createElement("input");
    manualLinkEl.className = "manual-link";
    manualLinkEl.readOnly = true;
    manualLinkEl.setAttribute("aria-label", "Level link");
    copyLinkBtn.after(manualLinkEl);
    manualLinkEl.addEventListener("blur", () => {
      manualLinkEl?.remove();
      manualLinkEl = null;
    });
  }
  manualLinkEl.value = url;
  manualLinkEl.select();
}

main().catch((err) => {
  console.error(err);
  statusEl.textContent = `Failed to load: ${(err as Error).message}`;
  statusEl.className = "status lose";
});
