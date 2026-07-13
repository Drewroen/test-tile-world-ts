import { Tile, NORTH, WEST, SOUTH, EAST, type MapCell } from "tworld-engine";
import { drawTile, type Tileset } from "./tileset";

export const GRID = 32;

// "full" shows the entire 32x32 map at once. "traditional" mirrors the
// original game's windowed view: a 9x9 tile area centered on Chip,
// clamped so the window never scrolls past the map edges.
export type ViewportMode = "full" | "traditional";
export const TRADITIONAL_SIZE = 9;
const EIGHTHS_PER_TILE = 8;

// Cell sizes are chosen so both modes scale cleanly from the 48px source
// sprites: 24 is an exact half-scale (48/24=2) for the zoomed-out full
// view, and 48 is native resolution (no scaling) for the zoomed-in
// traditional view.
export const CELL_SIZES: Record<ViewportMode, number> = {
  full: 24,
  traditional: 48,
};

export interface Viewport {
  x0: number;
  y0: number;
  width: number;
  height: number;
  fracX: number;
  fracY: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

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

function isCreatureId(id: number): boolean {
  return id >= Tile.Chip && id < Tile.Water_Splash;
}

// A Creature's `id` is the bare base type (e.g. Tile.Chip) and `dir` is a
// separate NORTH/WEST/SOUTH/EAST bitmask (1/2/4/8) — unlike a map cell's
// tile id, which already has the direction packed into its low 2 bits
// (crtile(id, dir) = id | diridx(dir)). Reproduce that packing here so
// creature-list entries look up the same sprite table as map tiles.
// diridx: NORTH(1)->0, WEST(2)->1, SOUTH(4)->2, EAST(8)->3.
function diridx(dir: number): number {
  return (0x30210 >> (dir * 2)) & 3;
}

function packedCreatureTile(cr: { id: number; dir: number }): number {
  return cr.id | diridx(cr.dir);
}

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

    // pos is already the destination tile once a move starts; moving
    // counts down from 8 to 0 (eighths of a tile) as the creature eases
    // into it, so it's drawn offset backward along its direction of
    // travel and slides forward as moving shrinks.
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
