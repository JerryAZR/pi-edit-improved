import { describe, expect, it } from "vitest";
import { matchUniqueRegion } from "../src/match-region.js";

// Helper: build positions from a pattern string.
// "." = any char, "B" = contextBefore, "A" = contextAfter
// B positions are shifted by 1 (single-char placeholder) to represent region start.
function parse(str: string, beforeChar: string, afterChar: string): {
  beforePositions: number[];
  afterPositions: number[];
} {
  const before: number[] = [];
  const after: number[] = [];
  for (let i = 0; i < str.length; i++) {
    if (str[i] === beforeChar) before.push(i + 1); // shift to region start
    if (str[i] === afterChar) after.push(i);
  }
  return { beforePositions: before, afterPositions: after };
}

function match(str: string) {
  const { beforePositions, afterPositions } = parse(str, "B", "A");
  return matchUniqueRegion(beforePositions, afterPositions);
}

describe("matchUniqueRegion", () => {
  // ── Trivial ──────────────────────────────────────────────

  it("empty both arrays → not_found", () => {
    expect(matchUniqueRegion([], [])).toEqual({ type: "not_found" });
  });

  it("empty before, non-empty after → not_found", () => {
    expect(matchUniqueRegion([], [0])).toEqual({ type: "not_found" });
  });

  it("non-empty before, empty after → not_found", () => {
    expect(matchUniqueRegion([0], [])).toEqual({ type: "not_found" });
  });

  // ── Unique contexts → unique pair ────────────────────────

  it("single B, single A → unique pair", () => {
    const r = match(".B.A..");
    expect(r).toEqual({ type: "unique", beforeIndex: 2, afterIndex: 3 });
  });

  it("single B, single A — adjacent → unique pair", () => {
    const r = match("BA");
    expect(r).toEqual({ type: "unique", beforeIndex: 1, afterIndex: 1 });
  });

  it("single B, single A — overlapping (A inside B) → not_found", () => {
    // beforeLen = 3, region starts at 3. A starts at 1. 1 < 3 → not_found
    const r = matchUniqueRegion([3], [1]);
    expect(r).toEqual({ type: "not_found" });
  });

  // ── Ambiguous ────────────────────────────────────────────

  it("two Bs, two As interleaved evenly → ambiguous", () => {
    // B.A.B.A → shifted B=[1,3], A=[1,3] → b=1→a=1, b=3→a=3 → 2 pairs
    const r = match("B.A.B.A");
    expect(r).toEqual({ type: "ambiguous" });
  });

  it("single B, two As both reachable → ambiguous", () => {
    // B.A.A → shifted B=[2], A=[3,5] → b=2→a=3, b=2→a=5 → 2 pairs
    const r = match(".B.A.A.");
    expect(r).toEqual({ type: "ambiguous" });
  });

  it("two Bs, single A → ambiguous (two distinct regions)", () => {
    // B.B..A → shifted B=[1,2], A=[4] → (1,4) and (2,4) are different regions
    const r = match("BB..A");
    expect(r).toEqual({ type: "ambiguous" });
  });

  // ── The counterexample: both non-unique, yet unique pair ─

  it("AAA_BBB_AAA__BBB — both non-unique, unique pair", () => {
    // Before = "BBB" (3 chars). B starts: 4, 13. Shift: [7, 16]
    // After  = "AAA". A starts: 0, 8
    // b=7:  a=0 < 7 ✗, a=8 ≥ 7 ✓  → (7, 8)
    // b=16: a=8 already consumed → none
    const r = matchUniqueRegion([7, 16], [0, 8]);
    expect(r).toEqual({ type: "unique", beforeIndex: 7, afterIndex: 8 });
  });

  it("BBB___AAA_AAA___BBB — both non-unique, ambiguous", () => {
    // B starts: 0, 16. beforeLen=3. Shift: [3, 19]
    // A starts: 6, 10
    // b=3: a=6 ≥ 3 ✓, a=10 ≥ 3 ✓ → ambiguous
    const r = matchUniqueRegion([3, 19], [6, 10]);
    expect(r).toEqual({ type: "ambiguous" });
  });

  // ── One unique, one not ──────────────────────────────────

  it("B is unique, A appears multiple times → ambiguous if multiple A reachable", () => {
    // B....A.A → shifted B=[5], A=[5,6] → b=5→a=5, a=6 → 2 pairs
    const r = match("....BAA");
    expect(r).toEqual({ type: "ambiguous" });
  });

  it("B is unique, A multiple but only one reachable → unique", () => {
    // B at 2, A at [0,3]. Shift B: [3]
    // b=3 → a=0 < 3 ✗, a=3 ≥ 3 ✓ → 1 pair
    const r = matchUniqueRegion([3], [0, 3]);
    expect(r).toEqual({ type: "unique", beforeIndex: 3, afterIndex: 3 });
  });

  it("A is unique, B multiple → ambiguous (two distinct regions)", () => {
    // B.B..A → shifted B=[1,2], A=[5] → (1,5) and (2,5) are different regions
    const r = match("B.B..A");
    expect(r).toEqual({ type: "ambiguous" });
  });

  // ── Not found ────────────────────────────────────────────

  it("all As are before all Bs → not_found", () => {
    // AABB → shifted B=[2,3], A=[0,1] → b=2, a=0<2, a=1<2 → skip both → no A left
    const r = match("AABB");
    expect(r).toEqual({ type: "not_found" });
  });

  it("all As overlap with B → not_found", () => {
    // beforeLen = 5 → region start at 5. A at 2. 2 < 5 → not_found
    const r = matchUniqueRegion([5], [2]);
    expect(r).toEqual({ type: "not_found" });
  });

  // ── Adjacent ─────────────────────────────────────────────

  it("adjacent pair → valid, zero-length region", () => {
    // B at 0, beforeLen=1 → region start 1. A at 1. 1 ≥ 1 ✓
    const r = matchUniqueRegion([1], [1]);
    expect(r).toEqual({ type: "unique", beforeIndex: 1, afterIndex: 1 });
  });

  // ── Short-circuit on second pair ─────────────────────────

  it("stops scanning as soon as second valid pair is found", () => {
    // Shift B by 1: [1, 11, 21], A=[1, 11, 21]
    const r = matchUniqueRegion([1, 11, 21], [1, 11, 21]);
    // b=1→a=1, b=11→a=11 → ambiguous
    expect(r).toEqual({ type: "ambiguous" });
  });

  // ── Region start must not exceed region end ──────────────

  it("region start at EOF, after at EOF → valid (zero-length at end)", () => {
    const r = matchUniqueRegion([10], [10]);
    expect(r).toEqual({ type: "unique", beforeIndex: 10, afterIndex: 10 });
  });
});
