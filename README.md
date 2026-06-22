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
## What we tried, and how each failed

We iterated through three schemas. Each introduced a different class of model error.

### Attempt 1: Explicit context fields (`contextBefore`, `contextAfter`)

```json
{
  "contextBefore": "function setup() {\n  // init\n",
  "contextAfter": "  return result;\n}\n",
  "newText": "  // added logic\n"
}
```

The thinking: separate "what anchors the region" from "what to put there".

**How models broke it:**
- **Deleted context lines.** The model would put `"  // init\n"` in `contextBefore` but omit it from `newText`, not realizing the context is part of the *replaced* region. The line disappeared.
- **Duplicated context lines.** Conversely, the model would include the context lines in `newText` as well, producing `"  // init\n  // added logic\n"` — the boundary appeared twice.
- **Boundary confusion.** Models struggled to decide whether the line after `contextAfter` should be the first line of `newText` or the first line kept outside the edit. The conceptual gap between "what's replaced" and "what's new" was too wide.
- **Context/newText mix-ups.** Models sometimes put the replacement text into `contextAfter`, or included unchanged lines in `newText` that were already covered by the context.

### Attempt 2: Tuple form (`[contextBefore, newText, contextAfter]`)

Same idea, positional syntax:

```json
[
  "function setup() {\n  // init\n",
  "  // added logic\n",
  "  return result;\n}\n"
]
```

**How models broke it:** All the same failures as Attempt 1, plus positional confusion — models would swap slots, put `newText` in position 1, or cram everything into position 2. The array syntax amplified the boundary confusion.

### Attempt 3: `{ oldText, newText }` with `...` abbreviation (final)

Returned to the familiar exact-text replacement schema:

```json
{
  "oldText": "function setup() {\n  // init\n...\n  return result;\n}\n",
  "newText": "function setup() {\n  // init\n  // added logic\n  return result;\n}\n"
}
```

The `...` on its own line acts as an ellipsis: everything before it and after it are matched as anchors, then the entire block between them is replaced. The familiar `{ oldText, newText }` shape stays.

**How models broke it:** They didn't break — they just ignored the feature. Models kept sending the full `oldText` verbatim. The tool included a tip (`"tip: use '...' in oldText to abbreviate large blocks"`) in success messages, fuzzy matching to tolerate whitespace/Unicode differences, and Levenshtein distance matching for small typos — all technically correct. But the model almost never used `...`.

---

## What we learned

The only thing we can say with confidence — because we observed it empirically in test sessions — is how models behave under each schema:

### What failed (observed)

**Explicit context fields make models worse at boundaries.** Splitting "what finds the region" from "what to put there" creates a mental gap that models systematically fill by either deleting or duplicating the boundary lines. The failure mode (silent data loss) is worse than the token waste it aimed to solve.

**Opt‑in token shortcuts aren't adopted.** The `...` abbreviation was documented, described in tool guidelines, and nudged in success messages — models still send the full text. The familiar `{ oldText, newText }` shape reduces errors but the model never reaches for the shortcut.

Possible reasons:
- **Familiarity bias.** Models are heavily trained on `{ oldText, newText }`. An opt‑in variation requires conscious strategy switching.
- **Conservative defaults.** An ellipsis edit that fails is worse than a verbose edit that succeeds. The model avoids risk.
- **No token‑cost feedback.** The model doesn't see the cost of its verbose `oldText`. Without that signal, verbosity is invisible.
- **Prompt descriptions compete for attention.** A paragraph among dozens of tool instructions can't override ingrained behavior.

### What we can't claim

We added fuzzy matching (copied from pi's built-in edit) and distance-based Levenshtein matching. These features are implemented and tested, but we never A/B compared them against a baseline without them. We don't know whether they improve edit success rates in practice.

### Key takeaway

Three schemas, three failure modes:
1. **Explicit context fields** → models delete or duplicate boundary lines
2. **Tuple form** → same boundary issues, plus positional confusion
3. **`...` abbreviation** → models ignore the shortcut, keep sending full text

For an edit schema to be both token‑efficient and model‑safe, it must either:
- **Force efficiency structurally** (hash anchors, diffs) where verbosity is impossible, or
- **Provide runtime feedback** (warnings, truncated history, fine‑tuning) that make the cost of verbosity visible to the model.

An opt‑in shortcut in a voluntary‑verbosity schema doesn't bridge that gap. Context‑field schemas introduce boundary errors that are worse than the token waste they solve.

---

## Why we're archiving

This project was an experiment with a clear hypothesis: models will use a token‑efficient edit schema. We tried three approaches. All three failed — each differently.

We're archiving rather than deleting because:
- The test suite covers edge cases that were hard to get right (multi‑segment DP, BOF/EOF, ambiguous context, Unicode normalization)
- The retrospective across all three schema attempts may save others from running the same experiments

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
