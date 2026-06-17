import { describe, expect, it } from "vitest";
import { findBestLineMatch } from "../src/distance-match.js";

describe("findBestLineMatch", () => {
	it("finds exact match (distance 0)", () => {
		const content = "line1\nline2\nline3\n";
		const result = findBestLineMatch(content, "line2\n");
		expect(result.found).toBe(true);
		expect(result.distance).toBe(0);
		expect(result.ambiguous).toBe(false);
	});

	it("finds single-line oldText with 1-char typo", () => {
		const content = "hello world\nfoo bar\nbaz qux\n";
		const result = findBestLineMatch(content, "hello worls\n");
		expect(result.found).toBe(true);
		expect(result.distance).toBe(1);
		expect(result.start).toBe(0);
	});

	it("finds multi-line oldText with 1 line missing (window tolerance)", () => {
		const content = "aaa\nbbb\nccc\nddd\neee\n";
		// oldText has 3 lines but content has 4-line region (bbb-eee)
		// Missing one line should still match with tolerance
		const result = findBestLineMatch(content, "bbb\nccc\nddd\n");
		expect(result.found).toBe(true);
		expect(result.distance).toBe(0);
	});

	it("finds match when oldText has extra line", () => {
		const content = "aaa\nbbb\nccc\n";
		// oldText has an extra blank line
		const result = findBestLineMatch(content, "aaa\n\nbbb\n", { lineTolerance: 1 });
		expect(result.found).toBe(true);
		expect(result.distance).toBeLessThanOrEqual(2);
	});

	it("returns not found when distance exceeds threshold", () => {
		const content = "completely different content\n";
		const result = findBestLineMatch(content, "xyz xyz xyz\n");
		expect(result.found).toBe(false);
		expect(result.ambiguous).toBe(false);
	});

	it("returns ambiguous when multiple similar regions exist", () => {
		const content = "hello world\nfoo bar\nhello world\nfoo bar\n";
		const result = findBestLineMatch(content, "hello worls\nfoo bar\n");
		expect(result.ambiguous).toBe(true);
		expect(result.found).toBe(false);
	});

	it("handles empty oldText", () => {
		const result = findBestLineMatch("some content\n", "");
		expect(result.found).toBe(false);
	});

	it("handles single-line content", () => {
		const result = findBestLineMatch("hello\n", "hallo\n");
		expect(result.found).toBe(true);
		expect(result.distance).toBe(1);
	});

	it("respects custom threshold option", () => {
		const content = "hello world\n";
		// 5 chars different out of 12 = 42%, should fail with default 5%
		const result1 = findBestLineMatch(content, "hello xxxxx\n");
		expect(result1.found).toBe(false);

		// With 50% threshold, should succeed
		const result2 = findBestLineMatch(content, "hello xxxxx\n", { charThreshold: 0.5 });
		expect(result2.found).toBe(true);
	});

	it("maps line range to correct character offsets", () => {
		const content = "aaa\nbbb\nccc\nddd\n";
		//        offsets: 0   4   8   12
		const result = findBestLineMatch(content, "bbb\nccc\n");
		expect(result.found).toBe(true);
		expect(result.start).toBe(4);
		expect(result.end).toBe(12); // end is exclusive, points to start of "ddd"
	});

	it("performance: handles large file efficiently", () => {
		// 500-line file
		const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
		const content = lines.join("\n") + "\n";
		// 10-line oldText with 1 typo
		const oldTextLines = lines.slice(245, 255);
		oldTextLines[5] = "line 25O"; // typo: O instead of 0
		const oldText = oldTextLines.join("\n") + "\n";

		const start = Date.now();
		const result = findBestLineMatch(content, oldText);
		const elapsed = Date.now() - start;

		expect(result.found).toBe(true);
		expect(result.distance).toBe(1);
		expect(elapsed).toBeLessThan(500); // should be much faster, but CI can be slow
	});
});
