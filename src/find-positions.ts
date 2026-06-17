/**
 * Find all start positions of `needle` in `haystack`.
 * Returns a sorted array of character offsets.
 */
export function findAllPositions(haystack: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const positions: number[] = [];
  let pos = 0;
  while (true) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    positions.push(idx);
    pos = idx + 1; // allow overlapping matches (e.g. "AAA" in "AAAA")
  }
  return positions;
}
