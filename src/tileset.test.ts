import { describe, expect, test } from "vitest";
import { applyChromaKey, SHADOW_ALPHA } from "./tileset";

const KEY: [number, number, number, number] = [255, 0, 255, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];
const OPAQUE: [number, number, number, number] = [10, 20, 30, 255];

function buffer(pixels: [number, number, number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  });
  return data;
}

function pixelAt(data: Uint8ClampedArray, i: number): [number, number, number, number] {
  return [data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!, data[i * 4 + 3]!];
}

describe("applyChromaKey", () => {
  test("leaves ordinary artwork pixels untouched", () => {
    const data = buffer([OPAQUE, OPAQUE, OPAQUE]);
    applyChromaKey(data, 3, 1);
    expect(pixelAt(data, 0)).toEqual(OPAQUE);
    expect(pixelAt(data, 1)).toEqual(OPAQUE);
    expect(pixelAt(data, 2)).toEqual(OPAQUE);
  });

  test("makes isolated magenta (no black neighbor) fully transparent", () => {
    // A magenta pixel surrounded only by ordinary artwork, never touching
    // black, should be a plain chroma-keyed transparent pixel.
    const data = buffer([OPAQUE, KEY, OPAQUE]);
    applyChromaKey(data, 3, 1);
    const [r, g, b, a] = pixelAt(data, 1);
    expect([r, g, b]).toEqual([255, 0, 255]);
    expect(a).toBe(0);
  });

  test("merges a true magenta/black dither pair into a soft shadow", () => {
    const data = buffer([BLACK, KEY]);
    applyChromaKey(data, 2, 1);
    expect(pixelAt(data, 0)).toEqual([0, 0, 0, SHADOW_ALPHA]);
    expect(pixelAt(data, 1)).toEqual([0, 0, 0, SHADOW_ALPHA]);
  });

  // Regression test for the bug fixed alongside this test: the chroma-key
  // pass used to scan pixels in place and read a pixel's left/up neighbors
  // out of that same, already-mutated buffer. Once one pixel became
  // (0,0,0,alpha), every magenta pixel after it in scan order saw a "black"
  // neighbor and got converted too, cascading the shadow tint across an
  // entire sprite's background — turning keys, boots, and Chip's tile into
  // a flat gray box instead of leaving the floor visible beneath them.
  test("does not cascade the shadow tint past pixels that actually touch black", () => {
    // A single true dither pixel at the start of a long, otherwise plain
    // magenta run (mirrors a small drop-shadow corner sitting in front of a
    // sprite's much larger open background).
    const data = buffer([BLACK, KEY, KEY, KEY, KEY]);
    applyChromaKey(data, 5, 1);

    // pixel 0 (black) and pixel 1 (its true magenta neighbor) blend into
    // the soft shadow...
    expect(pixelAt(data, 0)).toEqual([0, 0, 0, SHADOW_ALPHA]);
    expect(pixelAt(data, 1)).toEqual([0, 0, 0, SHADOW_ALPHA]);

    // ...but everything further along the row never touched a real black
    // pixel in the original artwork, so it must be plain transparent, not
    // shadow-tinted gray.
    for (const i of [2, 3, 4]) {
      const [r, g, b, a] = pixelAt(data, i);
      expect([r, g, b], `pixel ${i} rgb`).toEqual([255, 0, 255]);
      expect(a, `pixel ${i} alpha`).toBe(0);
    }
  });

  test("does not cascade vertically through an already-mutated row above", () => {
    // Same idea as the horizontal case, but seeded via the row-above
    // neighbor instead of the left neighbor.
    const data = buffer([BLACK, KEY, KEY, KEY, KEY]);
    applyChromaKey(data, 1, 5);

    expect(pixelAt(data, 0)).toEqual([0, 0, 0, SHADOW_ALPHA]);
    expect(pixelAt(data, 1)).toEqual([0, 0, 0, SHADOW_ALPHA]);
    for (const i of [2, 3, 4]) {
      const [r, g, b, a] = pixelAt(data, i);
      expect([r, g, b], `pixel ${i} rgb`).toEqual([255, 0, 255]);
      expect(a, `pixel ${i} alpha`).toBe(0);
    }
  });
});
