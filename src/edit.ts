import type { Static } from "typebox";
import { Type } from "typebox";
import { readFile, writeFile } from "fs/promises";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import * as Diff from "diff";
import { findAllPositions } from "./find-positions.js";
import { matchUniqueRegion } from "./match-region.js";
import { stripBom } from "./bom.js";
import { detectLineEnding, normalizeToLF, restoreLineEndings } from "./line-endings.js";
import { normalizeForFuzzyMatch, fuzzyFindText, countOccurrences } from "./fuzzy-match.js";
import { findBestLineMatch } from "./distance-match.js";

// ── Schema ──────────────────────────────────────────────────

const replaceEditItemSchema = Type.Object(
  {
    oldText: Type.String({
      description:
        "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call. To replace a large block without retyping every line, write at least 3 lines, then '...' on its own line, then at least 3 more lines — the tool matches the first and last lines and replaces the entire block.",
    }),
    newText: Type.String({ description: "Replacement text for this targeted edit." }),
  },
  { additionalProperties: false },
);

export const editSchema = Type.Object(
  {
    path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
    edits: Type.Array(replaceEditItemSchema, {
      description:
        "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
    }),
  },
  { additionalProperties: false },
);

export type EditInput = Static<typeof editSchema>;
export type ReplaceEditItem = Static<typeof replaceEditItemSchema>;

// ── Resolved region ────────────────────────────────────────

interface ResolvedEdit {
  start: number; // region to replace: [start, end)
  end: number;
  newText: string;
  editIndex: number; // for error messages
}

// ── Input parsing ──────────────────────────────────────────

function prepareArguments(input: unknown): EditInput {
  if (!input || typeof input !== "object") {
    return input as EditInput;
  }

  const args = input as Record<string, unknown>;

  // Some models send edits as a JSON string
  if (typeof args.edits === "string") {
    try {
      const parsed = JSON.parse(args.edits);
      if (Array.isArray(parsed)) args.edits = parsed;
    } catch { /* ignore */ }
  }

  return args as EditInput;
}

function validateInput(input: EditInput): { path: string; edits: ReplaceEditItem[] } {
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
  }
  return { path: input.path, edits: input.edits };
}

// ── Resolve a single edit ──────────────────────────────────

function resolveEdit(
  content: string,
  edit: ReplaceEditItem,
  editIndex: number,
): ResolvedEdit {
  const oldText = normalizeToLF(edit.oldText);
  const newText = normalizeToLF(edit.newText);

  // Try exact match first — the file might literally contain "..."
  // Try exact match first — the file might literally contain "..."
  if (oldText.length > 0) {
    const idx = content.indexOf(oldText);
    if (idx !== -1) {
      const secondIdx = content.indexOf(oldText, idx + 1);
      if (secondIdx === -1) {
        return { start: idx, end: idx + oldText.length, newText, editIndex };
      }
      // Exact match found but not unique — do NOT fall through to ellipsis
      throw new Error(
        `Found multiple occurrences of oldText for edits[${editIndex}]. ` +
        `The text must be unique. Provide more context to make it unique.`,
      );
    }
  }

  // Ellipsis fallback: split on "..." lines into segments
  const lines = oldText.split("\n");
  const ellipsisIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\.\.\.\s*$/.test(lines[i])) ellipsisIndices.push(i);
  }

  if (ellipsisIndices.length > 0) {
    // Collect all non-ellipsis segments
    const segments: string[] = [];
    let prevIdx = -1;
    for (const ei of ellipsisIndices) {
      segments.push(lines.slice(prevIdx + 1, ei).join("\n"));
      prevIdx = ei;
    }
    segments.push(lines.slice(prevIdx + 1).join("\n"));
    return resolveMultiSegmentEdit(content, segments, newText, editIndex);
  }

  // Not found
  return resolveExactEdit(content, oldText, newText, editIndex);
}


function resolveMultiSegmentEdit(
  content: string,
  segments: string[],
  newText: string,
  editIndex: number,
): ResolvedEdit {
  if (segments.length === 0) {
    // All `...` — replace entire file
    return { start: 0, end: content.length, newText, editIndex };
  }
  if (segments.length === 1) {
    return resolveExactEdit(content, segments[0], newText, editIndex);
  }
  if (segments.length === 2) {
    return resolveContextEdit(content, segments[0], segments[1], newText, editIndex);
  }

  // 3+ segments — DP for ordered non-overlapping matching
  let pairs: { firstStart: number; lastEnd: number }[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (seg.length === 0) {
      if (i === 0) pairs.push({ firstStart: 0, lastEnd: 0 });
      continue;
    }

    const positions = findAllPositions(content, seg);
    const segLen = seg.length;

    if (pairs.length === 0) {
      for (const p of positions) {
        pairs.push({ firstStart: p, lastEnd: p + segLen });
      }
    } else {
      const next: typeof pairs = [];
      for (const pair of pairs) {
        for (const p of positions) {
          if (p >= pair.lastEnd) {
            const fs = pair.firstStart;
            const le = p + segLen;
            if (!next.some((np) => np.firstStart === fs && np.lastEnd === le)) {
              next.push({ firstStart: fs, lastEnd: le });
            }
          }
        }
      }
      pairs = next;
    }

    if (pairs.length === 0) {
      throw new Error(
        `Could not find a region matching the given context for edits[${editIndex}]. ` +
        `Ensure the segments match exactly including whitespace.`,
      );
    }
  }

  // Trailing empty segment → extend to EOF
  if (segments[segments.length - 1].length === 0 && pairs.length > 0) {
    for (const pair of pairs) {
      pair.lastEnd = content.length;
    }
  }

  // All final candidates must be the same range
  if (pairs.length === 0) {
    throw new Error(
      `Could not find a region matching the given context for edits[${editIndex}]. ` +
      `Ensure the segments match exactly including whitespace.`,
    );
  }

  const first = pairs[0];
  for (let i = 1; i < pairs.length; i++) {
    if (pairs[i].firstStart !== first.firstStart || pairs[i].lastEnd !== first.lastEnd) {
      throw new Error(
        `Found multiple regions matching the given context for edits[${editIndex}]. ` +
        `Provide more context to make the region unique.`,
      );
    }
  }

  return {
    start: first.firstStart,
    end: first.lastEnd,
    newText,
    editIndex,
  };
}
function resolveContextEdit(
  content: string,
  contextBefore: string,
  contextAfter: string,
  newText: string,
  editIndex: number,
): ResolvedEdit {
  // Region to replace is [start_of_prefix, end_of_suffix) — the entire oldText block.
  // The prefix and suffix are part of the replaced region, not kept context markers.

  const beforePositions =
    contextBefore.length === 0
      ? [0]
      : findAllPositions(content, contextBefore);

  const afterPositions =
    contextAfter.length === 0
      ? [content.length]
      : findAllPositions(content, contextAfter).map((p) => p + contextAfter.length);

  if (contextBefore.length === 0 && afterPositions.length > 1) {
    throw new Error(
      `Found multiple regions matching the given context for edits[${editIndex}]. ` +
      `The suffix appears ${afterPositions.length} times — provide more context to make the region unique.`,
    );
  }

  if (contextAfter.length === 0 && beforePositions.length > 1) {
    throw new Error(
      `Found multiple regions matching the given context for edits[${editIndex}]. ` +
      `The prefix appears ${beforePositions.length} times — provide more context to make the region unique.`,
    );
  }

  const match = matchUniqueRegion(beforePositions, afterPositions);

  if (match.type === "not_found") {
    throw new Error(
      `Could not find a region matching the given context for edits[${editIndex}]. ` +
      `Ensure the prefix and suffix match exactly including whitespace.`,
    );
  }

  if (match.type === "ambiguous") {
    throw new Error(
      `Found multiple regions matching the given context for edits[${editIndex}]. ` +
      `Provide more context to make the region unique.`,
    );
  }

  return {
    start: match.beforeIndex,
    end: match.afterIndex,
    newText,
    editIndex,
  };
}

function resolveExactEdit(
  content: string,
  oldText: string,
  newText: string,
  editIndex: number,
): ResolvedEdit {
  if (oldText.length === 0) {
    throw new Error(`edits[${editIndex}].oldText must not be empty.`);
  }

  // Try exact match first
  const idx = content.indexOf(oldText);
  if (idx !== -1) {
    const secondIdx = content.indexOf(oldText, idx + 1);
    if (secondIdx === -1) {
      return { start: idx, end: idx + oldText.length, newText, editIndex };
    }
    throw new Error(
      `Found multiple occurrences of oldText for edits[${editIndex}]. ` +
      `The text must be unique. Provide more context to make it unique, or use ... to span a large region.`,
    );
  }

  // Try normalized match
  const match = fuzzyFindText(content, oldText);
  if (match.found) {
    const occurrences = countOccurrences(content, oldText);
    if (occurrences > 1) {
      throw new Error(
        `Found multiple occurrences of oldText for edits[${editIndex}]. ` +
        `The text must be unique. Provide more context to make it unique, or use ... to span a large region.`,
      );
    }
    return {
      start: match.index,
      end: match.index + match.matchLength,
      newText,
      editIndex,
    };
  }

  // Try distance-based match
  const distanceMatch = findBestLineMatch(content, oldText);
  if (distanceMatch.found) {
    return {
      start: distanceMatch.start,
      end: distanceMatch.end,
      newText,
      editIndex,
    };
  }
  if (distanceMatch.ambiguous) {
    throw new Error(
      `Found multiple similar regions for edits[${editIndex}]. ` +
      `Provide more context to make the region unique.`,
    );
  }

  throw new Error(
    `Could not find oldText for edits[${editIndex}]. ` +
    `The text must match exactly including all whitespace and newlines.`,
  );
}

// ── Validate non-overlapping regions ───────────────────────

function checkOverlaps(resolved: ResolvedEdit[], path: string): void {
  // Sort by position so adjacent pairs are obvious
  const sorted = [...resolved].sort((a, b) => a.start - b.start || a.end - b.end);

  for (let i = 1; i < sorted.length; i++) {
    const left = sorted[i - 1];
    const right = sorted[i];
    if (left.start < right.end && right.start < left.end) {
      throw new Error(
        `edits[${left.editIndex}] and edits[${right.editIndex}] overlap in ${path}. ` +
        `Merge them into one edit or target disjoint regions.`,
      );
    }
  }
}

// ── Apply edits ────────────────────────────────────────────

function applyResolvedEdits(content: string, resolved: ResolvedEdit[]): string {
  // Sort by start descending for right-to-left application (offsets stay stable)
  const sorted = [...resolved].sort((a, b) => b.start - a.start);

  let result = content;
  for (const edit of sorted) {
    result = result.substring(0, edit.start) + edit.newText + result.substring(edit.end);
  }
  return result;
}

// ── Diff generation ────────────────────────────────────────

function generateDiff(path: string, oldContent: string, newContent: string): string {
  return Diff.createTwoFilesPatch(path, path, oldContent, newContent, undefined, undefined, {
    context: 4,
    headerOptions: Diff.FILE_HEADERS_ONLY,
  });
}

// ── Execute ────────────────────────────────────────────────

export interface EditResult {
  content: Array<{ type: "text"; text: string }>;
  details: {
    diff: string;
  };
}

export async function executeEdit(
  input: EditInput,
  cwd: string,
): Promise<EditResult> {
  const prepared = prepareArguments(input);
  const { path, edits } = validateInput(prepared);

  return withFileMutationQueue(path, async () => {
    // Read file
    const buffer = await readFile(path);
    const rawContent = buffer.toString("utf-8");

    // Strip BOM, normalize line endings
    const { bom, text } = stripBom(rawContent);
    const originalEnding = detectLineEnding(text);
    const originalContent = normalizeToLF(text);

    // Pre-scan: check if any edit needs normalized matching
    let needsNormalization = false;
    const normalizedEdits = edits.map((edit) => ({
      ...edit,
      oldText: normalizeToLF(edit.oldText),
      newText: normalizeToLF(edit.newText),
    }));
    for (const edit of normalizedEdits) {
      if (originalContent.indexOf(edit.oldText) === -1) {
        const fuzzyContent = normalizeForFuzzyMatch(originalContent);
        const fuzzyOldText = normalizeForFuzzyMatch(edit.oldText);
        if (fuzzyContent.indexOf(fuzzyOldText) !== -1) {
          needsNormalization = true;
          break;
        }
      }
    }

    // If normalization is needed, re-base all content to normalized space
    const content = needsNormalization
      ? normalizeForFuzzyMatch(originalContent)
      : originalContent;
    const activeEdits = needsNormalization
      ? normalizedEdits.map((e) => ({ ...e, oldText: normalizeForFuzzyMatch(e.oldText), newText: e.newText }))
      : normalizedEdits;

    // Resolve each edit to a region
    const resolved: ResolvedEdit[] = [];
    let longExactCount = 0;
    for (let i = 0; i < activeEdits.length; i++) {
      const edit = activeEdits[i];
      const r = resolveEdit(content, edit, i);
      const existing = content.substring(r.start, r.end);
      if (existing === r.newText) {
        continue;
      }
      // Track long exact-text edits: >10 lines, no "..."
      if (
        !/^\s*\.\.\.\s*$/m.test(edit.oldText) &&
        edit.oldText.split("\n").length > 10
      ) {
        longExactCount++;
      }
      resolved.push(r);
    }

    if (resolved.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No changes made to ${path}. All ${activeEdits.length} edit(s) produced identical content.`,
          },
        ],
        details: { diff: "" },
      };
    }

    // Validate batch
    checkOverlaps(resolved, path);

    // Apply edits
    const newContent = applyResolvedEdits(content, resolved);

    // Restore line endings, BOM, and write
    const finalContent = bom + restoreLineEndings(newContent, originalEnding);
    await writeFile(path, finalContent, "utf-8");

    // Generate diff against original (pre-normalization) content so only actual edits show
    const diff = generateDiff(path, originalContent, newContent);

    const applied = resolved.length;
    const skipped = activeEdits.length - applied;
    const skipNote = skipped > 0 ? ` (${skipped} edit(s) were no-ops)` : "";
    const longNote = longExactCount > 0
      ? ` (tip: use '...' in oldText to abbreviate large blocks)`
      : "";

    return {
      content: [
        {
          type: "text",
          text: `Successfully replaced ${applied} block(s) in ${path}.${skipNote}${longNote}\n\n${diff}`,
        },
      ],
      details: { diff },
    };
  });
}
