import { describe, expect, it } from "vitest";
import { buildHash, parseHash } from "./routing";

describe("parseHash", () => {
  it("parses a set + ruleset route", () => {
    expect(parseHash("#/CCLP1/ms")).toEqual({ setId: "CCLP1", ruleset: "ms", levelNumber: null });
  });

  it("parses a level deep link", () => {
    expect(parseHash("#/CCLP1/lynx/12")).toEqual({
      setId: "CCLP1",
      ruleset: "lynx",
      levelNumber: 12,
    });
  });

  it("decodes percent-encoded set ids", () => {
    expect(parseHash("#/My%20Set/ms")?.setId).toBe("My Set");
  });

  it("treats an empty hash as the landing page", () => {
    expect(parseHash("")).toBeNull();
    expect(parseHash("#")).toBeNull();
    expect(parseHash("#/")).toBeNull();
  });

  it("rejects malformed routes instead of guessing", () => {
    expect(parseHash("#/CCLP1")).toBeNull();
    expect(parseHash("#/CCLP1/msx")).toBeNull();
    expect(parseHash("#/CCLP1/ms/")).toBeNull();
    expect(parseHash("#/CCLP1/ms/0")).toBeNull();
    expect(parseHash("#/CCLP1/ms/-3")).toBeNull();
    expect(parseHash("#/CCLP1/ms/1.5")).toBeNull();
    expect(parseHash("#/CCLP1/ms/2/extra")).toBeNull();
    expect(parseHash("#//ms")).toBeNull();
  });
});

describe("buildHash", () => {
  it("omits the level when there isn't one", () => {
    expect(buildHash("CC1", "ms")).toBe("#/CC1/ms");
    expect(buildHash("CC1", "ms", null)).toBe("#/CC1/ms");
  });

  it("round-trips through parseHash", () => {
    const route = { setId: "Bob's Set", ruleset: "lynx" as const, levelNumber: 7 };
    expect(parseHash(buildHash(route.setId, route.ruleset, route.levelNumber))).toEqual(route);
  });
});
