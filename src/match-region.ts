/**
 * Find a unique region bounded by contextBefore and contextAfter.
 *
 * Given sorted positions of region starts (before) and region ends (after),
 * count valid ordered (b, a) pairs where a >= b. A pair is unique iff exactly
 * one B is <= the last A, and exactly one A is >= the first B — then the pair
 * is (firstB, lastA).
 */

export interface UniquePair {
  type: "unique";
  beforeIndex: number;
  afterIndex: number;
}

export interface NotFound {
  type: "not_found";
}

export interface Ambiguous {
  type: "ambiguous";
}

export type MatchResult = UniquePair | NotFound | Ambiguous;

export function matchUniqueRegion(
  beforePositions: number[],
  afterPositions: number[],
): MatchResult {
  if (beforePositions.length === 0 || afterPositions.length === 0) {
    return { type: "not_found" };
  }

  const firstB = beforePositions[0];
  const lastA = afterPositions[afterPositions.length - 1];

  if (lastA < firstB) {
    return { type: "not_found" };
  }

  // Count Bs that fall at or before the last A — must be exactly 1
  let bsBeforeLast = 0;
  for (const b of beforePositions) {
    if (b <= lastA) bsBeforeLast++;
    else break;
  }
  if (bsBeforeLast !== 1) {
    return { type: "ambiguous" };
  }

  // Count As that fall at or after the first B — must be exactly 1
  let asAfterFirst = 0;
  for (let i = afterPositions.length - 1; i >= 0; i--) {
    if (afterPositions[i] >= firstB) asAfterFirst++;
    else break;
  }
  if (asAfterFirst !== 1) {
    return { type: "ambiguous" };
  }

  return { type: "unique", beforeIndex: firstB, afterIndex: lastA };
}
