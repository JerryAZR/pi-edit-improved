import { describe, expect, it } from "vitest";
import { countOccurrences, fuzzyFindText, normalizeForFuzzyMatch } from "../src/fuzzy-match.js";

describe("normalizeForFuzzyMatch", () => {
	it("strips trailing whitespace per line", () => {
		expect(normalizeForFuzzyMatch("hello   \nworld  \n")).toBe("hello\nworld\n");
	});

	it("strips trailing tabs", () => {
		expect(normalizeForFuzzyMatch("hello\t\t\nworld\t\n")).toBe("hello\nworld\n");
	});

	it("preserves leading whitespace (indentation)", () => {
		expect(normalizeForFuzzyMatch("  hello\n    world\n")).toBe("  hello\n    world\n");
	});

	it("normalizes smart single quotes to ASCII", () => {
		expect(normalizeForFuzzyMatch("\u2018hello\u2019")).toBe("'hello'");
		expect(normalizeForFuzzyMatch("\u201A\u201B")).toBe("''");
	});

	it("normalizes smart double quotes to ASCII", () => {
		expect(normalizeForFuzzyMatch("\u201Chello\u201D")).toBe('"hello"');
		expect(normalizeForFuzzyMatch("\u201E\u201F")).toBe('""');
	});

	it("normalizes unicode dashes to ASCII hyphen", () => {
		expect(normalizeForFuzzyMatch("a\u2013b")).toBe("a-b"); // en-dash
		expect(normalizeForFuzzyMatch("a\u2014b")).toBe("a-b"); // em-dash
		expect(normalizeForFuzzyMatch("a\u2212b")).toBe("a-b"); // minus sign
		expect(normalizeForFuzzyMatch("a\u2010b")).toBe("a-b"); // hyphen
	});

	it("normalizes special unicode spaces to regular space", () => {
		expect(normalizeForFuzzyMatch("a\u00A0b")).toBe("a b"); // NBSP
		expect(normalizeForFuzzyMatch("a\u2003b")).toBe("a b"); // em space
		expect(normalizeForFuzzyMatch("a\u3000b")).toBe("a b"); // ideographic space
	});

	it("handles empty string", () => {
		expect(normalizeForFuzzyMatch("")).toBe("");
	});

	it("is idempotent", () => {
		const text = "hello   \nworld  \n";
		const normalized = normalizeForFuzzyMatch(text);
		expect(normalizeForFuzzyMatch(normalized)).toBe(normalized);
	});
});

describe("fuzzyFindText", () => {
	it("finds exact match without fuzzy", () => {
		const result = fuzzyFindText("hello world", "world");
		expect(result.found).toBe(true);
		expect(result.index).toBe(6);
		expect(result.matchLength).toBe(5);
		expect(result.usedFuzzyMatch).toBe(false);
		expect(result.contentForReplacement).toBe("hello world");
	});

	it("returns not found when neither exact nor fuzzy matches", () => {
		const result = fuzzyFindText("hello world", "xyz");
		expect(result.found).toBe(false);
		expect(result.index).toBe(-1);
		expect(result.usedFuzzyMatch).toBe(false);
	});

	it("finds via normalized trailing whitespace", () => {
		const content = "hello   \nworld\n";
		const oldText = "hello\nworld\n";
		const result = fuzzyFindText(content, oldText);
		expect(result.found).toBe(true);
		expect(result.usedFuzzyMatch).toBe(true);
		expect(result.index).toBe(0);
		expect(result.contentForReplacement).toBe("hello\nworld\n");
	});

	it("finds via normalized smart quotes", () => {
		const content = "console.log(\u201Chello\u201D)";
		const oldText = 'console.log("hello")';
		const result = fuzzyFindText(content, oldText);
		expect(result.found).toBe(true);
		expect(result.usedFuzzyMatch).toBe(true);
	});

	it("finds via normalized unicode dash", () => {
		const content = "const x = a\u2013b;";
		const oldText = "const x = a-b;";
		const result = fuzzyFindText(content, oldText);
		expect(result.found).toBe(true);
		expect(result.usedFuzzyMatch).toBe(true);
	});

	it("prefers exact match over fuzzy", () => {
		const content = "hello world";
		const oldText = "world";
		const result = fuzzyFindText(content, oldText);
		expect(result.found).toBe(true);
		expect(result.usedFuzzyMatch).toBe(false);
	});

	it("returns original content when exact match", () => {
		const content = "  hello   \n  world  \n";
		const oldText = "  hello   \n  world  \n";
		const result = fuzzyFindText(content, oldText);
		expect(result.found).toBe(true);
		expect(result.usedFuzzyMatch).toBe(false);
		expect(result.contentForReplacement).toBe(content);
	});

	it("returns normalized content when fuzzy match", () => {
		const content = "  hello   \n  world  \n";
		const oldText = "  hello\n  world\n";
		const result = fuzzyFindText(content, oldText);
		expect(result.found).toBe(true);
		expect(result.usedFuzzyMatch).toBe(true);
		expect(result.contentForReplacement).toBe("  hello\n  world\n");
	});
});

describe("countOccurrences", () => {
	it("counts exact occurrences", () => {
		expect(countOccurrences("aaa bbb aaa", "aaa")).toBe(2);
	});

	it("counts normalized occurrences (trailing whitespace)", () => {
		expect(countOccurrences("aaa   \nbbb\naaa\n", "aaa\n")).toBe(2);
	});

	it("returns 0 for empty needle", () => {
		expect(countOccurrences("hello", "")).toBe(0);
	});

	it("returns 0 when not found", () => {
		expect(countOccurrences("hello world", "xyz")).toBe(0);
	});

	it("counts 1 for unique occurrence", () => {
		expect(countOccurrences("hello world", "world")).toBe(1);
	});
});
