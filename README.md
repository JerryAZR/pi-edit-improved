# pi-edit-improved (archived)

> **Status: Archived.** This was an experiment. The implementation is solid, but the hypothesis didn't hold up in practice. See [What we learned](#what-we-learned).

---

## The hypothesis

Editing files is a core operation for coding agents. The dominant approach — exact text replacement with `{ oldText, newText }` — works well for small changes, but for large blocks the model wastes thousands of output tokens retyping unchanged lines. One wrong character and the edit fails.

**Hypothesis:** Give the model a simple shortcut — `...` on its own line inside `oldText` — and it will naturally abbreviate large blocks, saving tokens and reducing errors.

```json
{
  "oldText": "function setup() {\n  // init\n...\n  return result;\n}\n",
  "newText": "function setup() {\n  // init\n  // added logic\n  return result;\n}\n"
}
```

The tool matches the non‑`...` segments as an ordered subsequence and replaces the entire block. No new schema to learn, no line numbers to track, just fewer tokens.

---

## What we built

A drop-in replacement for pi's built-in `edit` tool with four resolution layers:

| Step | Strategy | What it tolerates |
|------|----------|-------------------|
| 1. Exact | `content.indexOf(oldText)` — unique match | Nothing. Must be character-perfect. |
| 2. Fuzzy | Unicode normalization + trailing whitespace stripping | Smart quotes, em dashes, NBSP, trailing spaces |
| 3. Distance | Windowed Levenshtein distance (line-aligned, ≤5% threshold, 2‑char floor) | Small typos, missing/extra lines |
| 4. Ellipsis | Split `oldText` on `...` lines, match segments as ordered subsequence via DP (3+) or intersection (2) | Anchored block replacement without retyping the middle |

Additional features:
- Multi-segment ellipsis (`line1\n...\nline2\n...\nline3`)
- Batch edits with overlap detection and no‑op filtering
- BOM preservation, CRLF normalization, serialized file access
- Unified diff in both model response and TUI card

---

## What we learned

### What worked

- **The implementation is correct.** The matching algorithm handles edge cases (empty segments, BOF/EOF, ambiguous regions, overlapping candidates) and passes 102 tests.
- **Exact + fuzzy + distance fallback is genuinely useful.** Models don't need to get pristine whitespace or Unicode right — the tool recovers gracefully.
- **Code quality improved through iteration.** The resolution cascade was refactored from a convoluted three-function dispatch into a clean flat pipeline; dead code and duplicate normalization were eliminated.

### What didn't work

**Models rarely use `...`.** Despite the feature being documented in the tool description, model guidelines, and even a tip in the success message (*"tip: use '...' in oldText to abbreviate large blocks"*), the model almost always sends the full `oldText` verbatim.

Possible reasons:
- **Familiarity bias.** Models are heavily trained on `{ oldText, newText }` schemas and default to copying blocks exactly. Introducing an opt‑in variation requires the model to consciously switch strategies, which it rarely does unprompted.
- **Prompt description isn't enough.** A paragraph in the tool description competes with hundreds of other instructions. The model doesn't internalize a feature it can choose not to use.
- **The cost of getting it wrong is high.** An ellipsis edit that fails (ambiguous context, not found) is more frustrating than a successful but verbose exact edit. Models may conservatively avoid the risk.
- **Token pressure isn't felt at edit time.** The model doesn't have a feedback loop that says "your last edit was 200 tokens, 180 of which were unchanged lines." Without that signal, verbosity is invisible.

### Key takeaway

Opt‑in shortcuts for token efficiency don't work reliably with current models. The model needs either:
- A **forced short schema** (hash anchors, diffs) where verbosity is impossible, or
- **Runtime feedback** that trains the model to use the shortcut (e.g., a warning when `oldText` > N lines, or truncation of verbose `oldText` in conversation history).

An opt‑in `...` shortcut in a voluntary‑verbosity schema doesn't bridge that gap.

---

## Why we're archiving

This project was an experiment with a clear hypothesis. The hypothesis failed — models don't adopt the shortcut. The implementation served its purpose as a testbed for ideas (fuzzy matching, distance matching, ellipsis resolution) and contributed to understanding what does and doesn't work for coding agent editing.

We're archiving rather than deleting because:
- The codebase is a clean reference for anyone exploring edit tool design
- The test suite covers edge cases that are easy to miss (multi-segment DP, BOF/EOF, ambiguous context)
- The retrospective may save others from running the same experiment

---

## File structure

```
src/
  edit.ts              — Main pipeline: schema, resolve, apply, diff
  fuzzy-match.ts       — Unicode normalization + exact/normalized match
  distance-match.ts    — Windowed Levenshtein line matching
  match-region.ts      — matchUniqueRegion for 2-segment ellipsis
  find-positions.ts    — findAllPositions (ordered substring positions)
  bom.ts               — BOM strip/restore
  line-endings.ts      — CRLF detection/normalization/restore
  path-utils.ts        — resolveToCwd
  tool-definition.ts   — Extension registration + TUI rendering
test/
  edit.test.ts         — 51 integration tests
  match-region.test.ts — 19 unit tests
  fuzzy-match.test.ts  — 20 unit tests
  distance-match.test.ts — 12 unit tests
tool-descriptions/
  edit.md              — Tool description
  edit-snippet.md      — Prompt snippet
```
