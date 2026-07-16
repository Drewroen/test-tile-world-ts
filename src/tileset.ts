import { Tile } from "tworld-engine";

// tiles.bmp (copied from the original tworld/res/ directory) is a 336x768,
// 24bpp bitmap laid out as a simple 7-column x 16-row grid of 48x48px
// tiles, with magenta (255,0,255) used as the transparent "key" color for
// tiles that need to show the floor underneath (keys, boots, Chip, and all
// other creatures). This layout and the (col,row) position of every tile
// id below is transcribed directly from the original C renderer's lookup
// table, tworld/generic/tile.c's `tileidmap[]` (loadtileset's small-format
// branch, `initsmalltileset`, uses `xopaque`/`yopaque` as direct grid
// coordinates — verified against tiles.bmp's actual dimensions: 336/7=48,
// 768/16=48).
export const TILE_SIZE = 48;
const TRANSPARENT_KEY = { r: 255, g: 0, b: 255 };

// Direction offsets match diridx() (state.h / tworld-engine's constants):
// NORTH=0, WEST=1, SOUTH=2, EAST=3. Creature tile ids are 4-aligned, so
// `Tile.X + offset` reproduces the engine's own crtile(id, dir) packing.
const N = 0;
const W = 1;
const S = 2;
const E = 3;

// [col, row] for every tile id that can appear in a decoded level or a
// live creature list. Transcribed from tile.c:76-193.
const TILE_POSITIONS: Record<number, [number, number]> = {
  [Tile.Empty]: [0, 0],
  [Tile.Slide_North]: [1, 2],
  [Tile.Slide_West]: [1, 4],
  [Tile.Slide_South]: [0, 13],
  [Tile.Slide_East]: [1, 3],
  [Tile.Slide_Random]: [3, 2],
  [Tile.Ice]: [0, 12],
  [Tile.IceWall_Northwest]: [1, 12],
  [Tile.IceWall_Northeast]: [1, 13],
  [Tile.IceWall_Southwest]: [1, 11],
  [Tile.IceWall_Southeast]: [1, 10],
  [Tile.Gravel]: [2, 13],
  [Tile.Dirt]: [0, 11],
  [Tile.Water]: [0, 3],
  [Tile.Fire]: [0, 4],
  [Tile.Bomb]: [2, 10],
  [Tile.Beartrap]: [2, 11],
  [Tile.Burglar]: [2, 1],
  [Tile.HintButton]: [2, 15],
  [Tile.Button_Blue]: [2, 8],
  [Tile.Button_Green]: [2, 3],
  [Tile.Button_Red]: [2, 4],
  [Tile.Button_Brown]: [2, 7],
  [Tile.Teleport]: [2, 9],
  [Tile.Wall]: [0, 1],
  [Tile.Wall_North]: [0, 6],
  [Tile.Wall_West]: [0, 7],
  [Tile.Wall_South]: [0, 8],
  [Tile.Wall_East]: [0, 9],
  [Tile.Wall_Southeast]: [3, 0],
  [Tile.HiddenWall_Perm]: [0, 5],
  [Tile.HiddenWall_Temp]: [2, 12],
  [Tile.BlueWall_Real]: [1, 14],
  [Tile.BlueWall_Fake]: [1, 15],
  [Tile.SwitchWall_Open]: [2, 6],
  [Tile.SwitchWall_Closed]: [2, 5],
  [Tile.PopupWall]: [2, 14],
  [Tile.CloneMachine]: [3, 1],
  [Tile.Door_Red]: [1, 7],
  [Tile.Door_Blue]: [1, 6],
  [Tile.Door_Yellow]: [1, 9],
  [Tile.Door_Green]: [1, 8],
  [Tile.Socket]: [2, 2],
  [Tile.Exit]: [1, 5],
  [Tile.ICChip]: [0, 2],
  [Tile.Key_Red]: [6, 5],
  [Tile.Key_Blue]: [6, 4],
  [Tile.Key_Yellow]: [6, 7],
  [Tile.Key_Green]: [6, 6],
  [Tile.Boots_Ice]: [6, 10],
  [Tile.Boots_Slide]: [6, 11],
  [Tile.Boots_Fire]: [6, 9],
  [Tile.Boots_Water]: [6, 8],
  [Tile.Block_Static]: [0, 10],
  [Tile.Overlay_Buffer]: [0, 0],
  [Tile.Exit_Extra_1]: [3, 10],
  [Tile.Exit_Extra_2]: [3, 11],
  [Tile.Burned_Chip]: [3, 4],
  [Tile.Bombed_Chip]: [3, 5],
  [Tile.Exited_Chip]: [3, 9],
  [Tile.Drowned_Chip]: [3, 3],
  [Tile.Swimming_Chip + N]: [3, 12],
  [Tile.Swimming_Chip + W]: [3, 13],
  [Tile.Swimming_Chip + S]: [3, 14],
  [Tile.Swimming_Chip + E]: [3, 15],
  [Tile.Chip + N]: [6, 12],
  [Tile.Chip + W]: [6, 13],
  [Tile.Chip + S]: [6, 14],
  [Tile.Chip + E]: [6, 15],
  [Tile.Pushing_Chip + N]: [6, 12],
  [Tile.Pushing_Chip + W]: [6, 13],
  [Tile.Pushing_Chip + S]: [6, 14],
  [Tile.Pushing_Chip + E]: [6, 15],
  [Tile.Block + N]: [0, 14],
  [Tile.Block + W]: [0, 15],
  [Tile.Block + S]: [1, 0],
  [Tile.Block + E]: [1, 1],
  [Tile.Tank + N]: [4, 12],
  [Tile.Tank + W]: [4, 13],
  [Tile.Tank + S]: [4, 14],
  [Tile.Tank + E]: [4, 15],
  [Tile.Ball + N]: [4, 8],
  [Tile.Ball + W]: [4, 9],
  [Tile.Ball + S]: [4, 10],
  [Tile.Ball + E]: [4, 11],
  [Tile.Glider + N]: [5, 0],
  [Tile.Glider + W]: [5, 1],
  [Tile.Glider + S]: [5, 2],
  [Tile.Glider + E]: [5, 3],
  [Tile.Fireball + N]: [4, 4],
  [Tile.Fireball + W]: [4, 5],
  [Tile.Fireball + S]: [4, 6],
  [Tile.Fireball + E]: [4, 7],
  [Tile.Bug + N]: [4, 0],
  [Tile.Bug + W]: [4, 1],
  [Tile.Bug + S]: [4, 2],
  [Tile.Bug + E]: [4, 3],
  [Tile.Paramecium + N]: [6, 0],
  [Tile.Paramecium + W]: [6, 1],
  [Tile.Paramecium + S]: [6, 2],
  [Tile.Paramecium + E]: [6, 3],
  [Tile.Teeth + N]: [5, 4],
  [Tile.Teeth + W]: [5, 5],
  [Tile.Teeth + S]: [5, 6],
  [Tile.Teeth + E]: [5, 7],
  [Tile.Blob + N]: [5, 12],
  [Tile.Blob + W]: [5, 13],
  [Tile.Blob + S]: [5, 14],
  [Tile.Blob + E]: [5, 15],
  [Tile.Walker + N]: [5, 8],
  [Tile.Walker + W]: [5, 9],
  [Tile.Walker + S]: [5, 10],
  [Tile.Walker + E]: [5, 11],
  [Tile.Water_Splash]: [3, 3],
  [Tile.Bomb_Explosion]: [3, 6],
  [Tile.Entity_Explosion]: [3, 7],
};

export interface Tileset {
  canvas: HTMLCanvasElement;
  positionOf(id: number): [number, number];
}

// Loads tiles.bmp, then chroma-keys out the magenta background (used by
// the original renderer's "keyed" tiles — keys, boots, and every creature)
// so those sprites composite correctly over whatever floor tile is drawn
// beneath them.
export async function loadTileset(url: string): Promise<Tileset> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load ${url}`));
    image.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    if (
      data[i] === TRANSPARENT_KEY.r &&
      data[i + 1] === TRANSPARENT_KEY.g &&
      data[i + 2] === TRANSPARENT_KEY.b
    ) {
      data[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  return {
    canvas,
    positionOf(id: number): [number, number] {
      return TILE_POSITIONS[id] ?? TILE_POSITIONS[Tile.Empty]!;
    },
  };
}

export function drawTile(
  ctx: CanvasRenderingContext2D,
  tileset: Tileset,
  id: number,
  dx: number,
  dy: number,
  size: number,
): void {
  const [col, row] = tileset.positionOf(id);
  ctx.drawImage(
    tileset.canvas,
    col * TILE_SIZE,
    row * TILE_SIZE,
    TILE_SIZE,
    TILE_SIZE,
    dx,
    dy,
    size,
    size,
  );
}
