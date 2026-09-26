import { describe, expect, it } from "vitest";
import {
  clearLastPlayed,
  completedLevels,
  getLastPlayed,
  hasSeenHowTo,
  markCompleted,
  markHowToSeen,
  saveLastPlayed,
} from "./progress";

// Map-backed Storage: these helpers are pure functions of a Storage, which is
// exactly why they're testable without a DOM.
class FakeStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const SET_URL = "https://bitbusters.club/gliderbot/sets/cc1/CCLP1.dat";
const INTRO_URL = "https://drewroen.github.io/test-tile-world-ts/intro.dat";

describe("completedLevels", () => {
  it("counts explicit completion marks", () => {
    const storage = new FakeStorage();
    markCompleted(storage, SET_URL, 3, 0);
    markCompleted(storage, SET_URL, 4, 1);
    expect([...completedLevels(storage, SET_URL)].sort((a, b) => a - b)).toEqual([3, 4]);
  });

  it("keeps sets apart even though their keys share a prefix", () => {
    const storage = new FakeStorage();
    markCompleted(storage, SET_URL, 1, 0);
    markCompleted(storage, INTRO_URL, 2, 0);
    expect([...completedLevels(storage, SET_URL)]).toEqual([1]);
    expect([...completedLevels(storage, INTRO_URL)]).toEqual([2]);
  });

  it("counts a level once when both a completion mark and a best time exist", () => {
    const storage = new FakeStorage();
    markCompleted(storage, SET_URL, 7, 0);
    storage.setItem(`tworld-besttime:${SET_URL}:0:7`, "120");
    expect([...completedLevels(storage, SET_URL)]).toEqual([7]);
  });

  it("still counts pre-existing best-time entries, since those imply a win", () => {
    const storage = new FakeStorage();
    storage.setItem(`tworld-besttime:${SET_URL}:1:11`, "88");
    expect([...completedLevels(storage, SET_URL)]).toEqual([11]);
  });

  it("ignores unrelated and malformed keys", () => {
    const storage = new FakeStorage();
    storage.setItem("tworld-howto-seen", "1");
    storage.setItem(`tworld-completed:${SET_URL}:0`, "1");
    storage.setItem(`tworld-completed:${SET_URL}:0:notanumber`, "1");
    storage.setItem(`tworld-besttime:${SET_URL}:x:5`, "1");
    expect(completedLevels(storage, SET_URL).size).toBe(0);
  });
});

describe("last played", () => {
  it("round-trips an entry", () => {
    const storage = new FakeStorage();
    const entry = { setId: "CCLP1", ruleset: "lynx" as const, levelNumber: 12, levelName: "Rant" };
    saveLastPlayed(storage, entry);
    expect(getLastPlayed(storage)).toEqual(entry);
  });

  it("returns null when absent, unreadable, or nonsensical", () => {
    const storage = new FakeStorage();
    expect(getLastPlayed(storage)).toBeNull();
    storage.setItem("tworld-last-played", "{not json");
    expect(getLastPlayed(storage)).toBeNull();
    storage.setItem("tworld-last-played", JSON.stringify({ setId: "CC1", ruleset: "dos", levelNumber: 1 }));
    expect(getLastPlayed(storage)).toBeNull();
    storage.setItem("tworld-last-played", JSON.stringify({ setId: "CC1", ruleset: "ms", levelNumber: 0 }));
    expect(getLastPlayed(storage)).toBeNull();
  });

  it("can be cleared", () => {
    const storage = new FakeStorage();
    saveLastPlayed(storage, { setId: "CC1", ruleset: "ms", levelNumber: 1, levelName: "" });
    clearLastPlayed(storage);
    expect(getLastPlayed(storage)).toBeNull();
  });
});

describe("how-to flag", () => {
  it("flips once and stays flipped", () => {
    const storage = new FakeStorage();
    expect(hasSeenHowTo(storage)).toBe(false);
    markHowToSeen(storage);
    expect(hasSeenHowTo(storage)).toBe(true);
  });
});
