import { distance } from "fastest-levenshtein";

/**
 * Maximum allowed edit distance as a ratio of oldText length.
 * E.g., 0.05 means up to 5% of characters can differ.
 * Tune this constant to adjust permissiveness.
 */
const MAX_DISTANCE_RATIO = 0.05;

/**
 * Minimum threshold in characters (floor). Ensures small edits
 * (e.g., 1-2 char typos) are always allowed even if ratio would be stricter.
 */
const MIN_THRESHOLD = 2;

/**
 * Line count tolerance for window size variation.
 * E.g., 0.2 means ±20% of expected line count.
 */
const LINE_TOLERANCE_RATIO = 0.2;

/**
 * Uniqueness margin: other windows with distance <= best + margin
 * are considered ambiguous candidates.
 */
const UNIQUENESS_MARGIN = 2;

export interface DistanceMatchResult {
	/** Whether a match was found within threshold */
	found: boolean;
	/** Start character offset in content (inclusive) */
	start: number;
	/** End character offset in content (exclusive) */
	end: number;
	/** Edit distance of the best match */
	distance: number;
	/** Whether multiple similar regions were found */
	ambiguous: boolean;
}

interface Candidate {
	startLine: number;
	endLine: number;
	distance: number;
}

export interface DistanceMatchOptions {
	/** Override line tolerance ratio (default: 0.2) */
	lineTolerance?: number;
	/** Override character threshold ratio (default: 0.05) */
	charThreshold?: number;
	/** Override uniqueness margin (default: 2) */
	uniquenessMargin?: number;
}

/**
 * Find the best line-aligned approximate match of oldText in content.
 *
 * Slides a window of varying line counts across content, computing
 * character-level Levenshtein distance for each window. Returns the
 * best match if within threshold and unique.
 */
export function findBestLineMatch(
	content: string,
	oldText: string,
	options?: DistanceMatchOptions,
): DistanceMatchResult {
	const notFound: DistanceMatchResult = {
		found: false,
		start: -1,
		end: -1,
		distance: -1,
		ambiguous: false,
	};

	if (oldText.length === 0) {
		return notFound;
	}

	// Strip trailing newline for line counting, but keep for distance comparison
	const oldTextStripped = oldText.endsWith("\n") ? oldText.slice(0, -1) : oldText;
	const oldTextLines = oldTextStripped.split("\n");
	const m = oldTextLines.length;

	const contentStripped = content.endsWith("\n") ? content.slice(0, -1) : content;
	const contentLines = contentStripped.split("\n");

	const lineTolerance = options?.lineTolerance ?? Math.max(1, Math.floor(m * LINE_TOLERANCE_RATIO));
	const thresholdRatio = options?.charThreshold ?? MAX_DISTANCE_RATIO;
	const uniquenessMargin = options?.uniquenessMargin ?? UNIQUENESS_MARGIN;

	const threshold = Math.max(MIN_THRESHOLD, Math.floor(oldText.length * thresholdRatio));

	// Window sizes to try
	const minWindow = Math.max(1, m - lineTolerance);
	const maxWindow = Math.min(contentLines.length, m + lineTolerance);

	let best: Candidate | null = null;
	const withinThreshold: Candidate[] = [];

	for (let w = minWindow; w <= maxWindow; w++) {
		for (let i = 0; i + w <= contentLines.length; i++) {
			const windowText = contentLines.slice(i, i + w).join("\n") + "\n";
			const d = distance(windowText, oldText);

			if (d <= threshold) {
				const candidate: Candidate = { startLine: i, endLine: i + w, distance: d };
				withinThreshold.push(candidate);
				if (best === null || d < best.distance) {
					best = candidate;
				}
			}
		}
	}

	if (best === null) {
		return notFound;
	}

	// Exact match is never ambiguous
	if (best.distance === 0) {
		const start = lineOffset(content, best.startLine);
		const end = lineOffset(content, best.endLine);
		return { found: true, start, end, distance: 0, ambiguous: false };
	}

	// Check for ambiguity: other within-threshold windows with similar distance
	let ambiguous = false;
	for (const c of withinThreshold) {
		if (c === best) continue;
		if (c.distance <= best.distance + uniquenessMargin) {
			ambiguous = true;
			break;
		}
	}

	if (ambiguous) {
		return {
			found: false,
			start: -1,
			end: -1,
			distance: best.distance,
			ambiguous: true,
		};
	}

	// Map line range to character offsets
	const start = lineOffset(content, best.startLine);
	const end = lineOffset(content, best.endLine);

	return {
		found: true,
		start,
		end,
		distance: best.distance,
		ambiguous: false,
	};
}

/** Get character offset of the start of a given line number (0-indexed). */
function lineOffset(content: string, lineNum: number): number {
	if (lineNum === 0) return 0;
	let offset = 0;
	let currentLine = 0;
	for (let i = 0; i < content.length; i++) {
		if (content[i] === "\n") {
			currentLine++;
			if (currentLine === lineNum) {
				return i + 1;
			}
		}
	}
	return content.length;
}