import { describe, expect, it } from "vitest";
import { CURATED_SETS, datUrl, parseSetsSnapshot, searchSets, type SetEntry } from "./sets";

const sets: SetEntry[] = [
  { id: "CCLP1", name: "CCLP1" },
  { id: "CCLP10", name: "CCLP10" },
  { id: "Intro", name: "Intro" },
  { id: "bookwallcclp1", name: "bookwallcclp1" },
  { id: "4.5", name: "4.5" },
  { id: "blobs", name: "blobs" },
];

describe("parseSetsSnapshot", () => {
  it("reads the shipped snapshot shape", () => {
    const parsed = parseSetsSnapshot({ generatedAt: "x", source: "y", sets: ["CC1", "CCLP1"] });
    expect(parsed.map((s) => s.id)).toEqual(["CC1", "CCLP1"]);
  });

  it("degrades to an empty catalogue on junk input", () => {
    expect(parseSetsSnapshot(null)).toEqual([]);
    expect(parseSetsSnapshot({})).toEqual([]);
    expect(parseSetsSnapshot({ sets: "CCLP1" })).toEqual([]);
    expect(parseSetsSnapshot({ sets: [42, "", "  ", "CC1"] })).toEqual([{ id: "CC1", name: "CC1" }]);
  });
});

describe("datUrl", () => {
  it("points at the CC1 mirror and escapes the id", () => {
    expect(datUrl("CCLP1")).toBe("https://bitbusters.club/gliderbot/sets/cc1/CCLP1.dat");
    expect(datUrl("Bob's Set")).toContain("Bob's%20Set.dat");
  });
});

describe("searchSets", () => {
  const curatedIds = ["Intro", "CCLP1"];

  it("lists the whole catalogue alphabetically when there's no query", () => {
    const { matches, total } = searchSets(sets, "", Infinity, curatedIds);
    expect(matches.map((s) => s.id)).toEqual(["4.5", "blobs", "bookwallcclp1", "CCLP10"]);
    expect(total).toBe(4);
  });

  it("keeps curated sets out of the browse list but at the top of a search", () => {
    expect(searchSets(sets, "", Infinity, curatedIds).matches.some((s) => s.id === "Intro")).toBe(false);
    expect(searchSets(sets, "intro", Infinity, curatedIds).matches[0]?.id).toBe("Intro");
  });

  it("ignores case, spaces and punctuation", () => {
    for (const query of ["cclp 1", "CCLP-1", "cclp1"]) {
      const { matches } = searchSets(sets, query, Infinity, curatedIds);
      expect(matches[0]?.id).toBe("CCLP1");
    }
  });

  it("ranks prefix matches above substring matches", () => {
    const { matches } = searchSets(sets, "cclp1", Infinity, curatedIds);
    expect(matches.map((s) => s.id)).toEqual(["CCLP1", "CCLP10", "bookwallcclp1"]);
  });

  it("reports the uncapped total so the UI can say 'showing N of M'", () => {
    const { matches, total } = searchSets(sets, "cclp", 1, curatedIds);
    expect(matches).toHaveLength(1);
    expect(total).toBe(3);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchSets(sets, "zzzz", Infinity, curatedIds)).toEqual({ matches: [], total: 0 });
  });

  it("ships curated sets whose ids are real .dat names", () => {
    expect(CURATED_SETS.map((s) => s.id)).toContain("CC1");
    expect(new Set(CURATED_SETS.map((s) => s.id)).size).toBe(CURATED_SETS.length);
  });
});
