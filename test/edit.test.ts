import { describe, expect, it } from "vitest";
import { writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { executeEdit } from "../src/edit.js";

async function withTempFile(content: string, fn: (filepath: string) => Promise<void>) {
  const dir = tmpdir();
  const name = `pi-ctx-edit-${randomUUID()}.txt`;
  const filepath = join(dir, name);
  await writeFile(filepath, content, "utf-8");
  try {
    await fn(filepath);
  } finally {
    await rm(filepath, { force: true });
  }
}

const cwd = process.cwd();

// Helper: build ellipsis oldText from prefix and suffix
function e(before: string, after: string): string {
  if (before === "" && after === "") return "...";
  if (before === "") return `...\n${after}`;
  if (after === "") return `${before}\n...`;
  return `${before}\n...\n${after}`;
}

describe("executeEdit", () => {
  // ── Exact match ──────────────────────────────────────────

  it("replaces exact oldText", async () => {
    await withTempFile("line1\nline2\nTARGET\nline5\n", async (path) => {
      const result = await executeEdit(
        { path, edits: [{ oldText: "TARGET\n", newText: "REPLACED\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("line1\nline2\nREPLACED\nline5\n");
      expect(result.details.diff).toBeTruthy();
    });
  });

  it("exact match not found → throws", async () => {
    await withTempFile("AAA\nBBB\n", async (path) => {
      await expect(
        executeEdit({ path, edits: [{ oldText: "ZZZ\n", newText: "XXX\n" }] }, cwd),
      ).rejects.toThrow(/Could not find/);
    });
  });

  it("exact match not unique → throws", async () => {
    await withTempFile("AAA\nBBB\nAAA\n", async (path) => {
      await expect(
        executeEdit({ path, edits: [{ oldText: "AAA\n", newText: "XXX\n" }] }, cwd),
      ).rejects.toThrow(/Found multiple occurrences/);
    });
  });

  it("empty oldText → throws", async () => {
    await withTempFile("test\n", async (path) => {
      await expect(
        executeEdit({ path, edits: [{ oldText: "", newText: "x\n" }] }, cwd),
      ).rejects.toThrow(/oldText must not be empty/);
    });
  });

  // ── Ellipsis: replaces entire block (prefix + suffix included) ──

  it("ellipsis: replaces from prefix start to suffix end", async () => {
    await withTempFile("A\nx1\nx2\nB\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: e("A\n", "B\n"), newText: "A\nREPLACED\nB\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("A\nREPLACED\nB\n");
    });
  });

  it("ellipsis: can drop prefix and suffix if model omits them from newText", async () => {
    await withTempFile("A\nx1\nx2\nB\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: e("A\n", "B\n"), newText: "GONE\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("GONE\n");
    });
  });

  it("ellipsis: adjacent prefix/suffix → full-block replace with no middle", async () => {
    await withTempFile("before\nafter\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: e("before\n", "after\n"), newText: "before\ninserted\nafter\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("before\ninserted\nafter\n");
    });
  });

  it("ellipsis: empty newText → delete entire block including prefix and suffix", async () => {
    await withTempFile("keep\nremove me\nkeep2\nend\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: e("keep\n", "keep2\n"), newText: "" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("end\n");
    });
  });

  // ── Ellipsis BOF / EOF (empty prefix or suffix) ──────────

  it("ellipsis: empty prefix → from BOF (prefix/suffix included in replacement)", async () => {
    await withTempFile("first\nsecond\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: e("", "second\n"), newText: "REPLACED\nsecond\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("REPLACED\nsecond\n");
    });
  });

  it("ellipsis: empty suffix → to EOF", async () => {
    await withTempFile("first\nsecond\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: e("first\n", ""), newText: "first\nREPLACED\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("first\nREPLACED\n");
    });
  });

  it("ellipsis: both empty → replace entire file", async () => {
    await withTempFile("old content\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "...", newText: "new content\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("new content\n");
    });
  });

  it("ellipsis: handles indented '...' (whitespace around)", async () => {
    await withTempFile("A\nx1\nx2\nB\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "A\n  ...\nB\n", newText: "A\nREPLACED\nB\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("A\nREPLACED\nB\n");
    });
  });

  it("ellipsis: multiple '...' — first/last define bounds, middle discarded", async () => {
    // oldText: "A\n...\nB\n...\nC\n" → prefix="A", suffix="C" (middle ... and B ignored)
    // File must contain A and C as the bounds of the replaced block
    await withTempFile("A\nx1\nB\nx2\nC\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "A\n...\nB\n...\nC\n", newText: "A\nREPLACED\nC\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("A\nREPLACED\nC\n");
    });
  });

  it("ellipsis: three '...' — first and last define bounds, middle two discarded", async () => {
    await withTempFile("A\nx1\nx2\nB\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "A\n...\nx1\n...\nx2\n...\nB\n", newText: "A\nREPLACED\nB\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("A\nREPLACED\nB\n");
    });
  });

  it("ellipsis: adjacent '...' lines — treated as one", async () => {
    await withTempFile("A\nx\nB\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "A\n...\n...\nB\n", newText: "A\nREPLACED\nB\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("A\nREPLACED\nB\n");
    });
  });

  it("ellipsis: '...' at both start and end → replace entire file", async () => {
    await withTempFile("old\ncontent\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "\n...\nold\ncontent\n...\n", newText: "new\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("new\n");
    });
  });

  it("ellipsis: exact match takes priority when file contains literal '...'", async () => {
    // File has literal ... as a separator. Model replaces only the first part.
    // oldText ends with ... which matches literally — exact match, not ellipsis split.
    await withTempFile("paragraph1\n...\nparagraph2\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "paragraph1\n...\n", newText: "intro\n...\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("intro\n...\nparagraph2\n");
    });
  });

  // ── Multi-segment ellipsis (3+ segments) ──

  it("three segments, all match in order → succeeds", async () => {
    await withTempFile("A\nx1\nB\nx2\nC\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "A\n...\nB\n...\nC\n", newText: "A\nREPLACED\nC\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("A\nREPLACED\nC\n");
    });
  });

  it("three segments, middle segment missing → not_found", async () => {
    await withTempFile("A\nx1\nx2\nC\n", async (path) => {
      await expect(
        executeEdit({ path, edits: [{ oldText: "A\n...\nB\n...\nC\n", newText: "A\nREPLACED\nC\n" }] }, cwd),
      ).rejects.toThrow(/Could not find/);
    });
  });

  it("three segments, ambiguous (multiple ways to match) → throws", async () => {
    await withTempFile("A\nB\nA\nB\nC\n", async (path) => {
      await expect(
        executeEdit({ path, edits: [{ oldText: "A\n...\nB\n...\nC\n", newText: "A\nREPLACED\nC\n" }] }, cwd),
      ).rejects.toThrow(/Found multiple regions/);
    });
  });

  it("four segments → basic success", async () => {
    await withTempFile("a\nb\nc\nd\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "a\n...\nb\n...\nc\n...\nd\n", newText: "a\nX\nd\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("a\nX\nd\n");
    });
  });

  it("leading ... with middle segments → prefix empty", async () => {
    await withTempFile("x\nB\nz\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "...\nB\n...\nz\n", newText: "INSERTED\nB\nz\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("INSERTED\nB\nz\n");
    });
  });

  it("trailing ... with middle segments → suffix empty", async () => {
    await withTempFile("a\nx\nB\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "a\n...\nB\n...\n", newText: "a\nB\nINSERTED\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("a\nB\nINSERTED\n");
    });
  });

  it("three segments, same region reachable via multiple middle paths → unique region", async () => {
    // A and C each appear once, B appears twice between them.
    // Paths: A→B₁→C and A→B₂→C both produce region [0, 8) — same region.
    await withTempFile("A\nB\nB\nC\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "A\n...\nB\n...\nC\n", newText: "A\nX\nC\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("A\nX\nC\n");
    });
  });

  // ── Ellipsis ambiguity ──────────────────────────────────

  it("ellipsis: suffix empty, prefix not unique → ambiguous", async () => {
    await withTempFile("function hello() {\n}\n\nfunction goodbye() {\n}\n", async (path) => {
      await expect(
        executeEdit({ path, edits: [{ oldText: e("}\n", ""), newText: "}\nINSERTED\n" }] }, cwd),
      ).rejects.toThrow(/Found multiple regions/);
    });
  });

  it("ellipsis: prefix empty, suffix not unique → ambiguous", async () => {
    await withTempFile("function hello() {\n}\n\nfunction goodbye() {\n}\n", async (path) => {
      await expect(
        executeEdit({ path, edits: [{ oldText: e("", "function "), newText: "INSERTED\nfunction " }] }, cwd),
      ).rejects.toThrow(/Found multiple regions/);
    });
  });

  it("ellipsis: ambiguous context → throws", async () => {
    await withTempFile("AAA\nBBB\nAAA\nBBB\n", async (path) => {
      await expect(
        executeEdit({ path, edits: [{ oldText: e("AAA\n", "BBB\n"), newText: "XXX\n" }] }, cwd),
      ).rejects.toThrow(/Found multiple regions/);
    });
  });

  it("ellipsis: context not found → throws", async () => {
    await withTempFile("AAA\nBBB\n", async (path) => {
      await expect(
        executeEdit({ path, edits: [{ oldText: e("ZZZ\n", "BBB\n"), newText: "XXX\n" }] }, cwd),
      ).rejects.toThrow(/Could not find/);
    });
  });

  // ── Multi-edit batch ────────────────────────────────────

  it("applies multiple non-overlapping edits in one call", async () => {
    await withTempFile("A\nx1\nB\ny1\nC\nz1\nD\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "x1\n", newText: "X\n" }, { oldText: "z1\n", newText: "Z\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("A\nX\nB\ny1\nC\nZ\nD\n");
    });
  });

  it("adjacent exact edits are allowed", async () => {
    await withTempFile("A\nx\nB\ny\nC\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "x\n", newText: "X\n" }, { oldText: "y\n", newText: "Y\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("A\nX\nB\nY\nC\n");
    });
  });

  // ── Overlap ─────────────────────────────────────────────

  it("overlapping regions → throws", async () => {
    await withTempFile("A\nx\nB\n", async (path) => {
      await expect(
        executeEdit(
          { path, edits: [{ oldText: e("", "B\n"), newText: "wide\nB\n" }, { oldText: e("A\n", ""), newText: "A\nwide2\n" }] },
          cwd,
        ),
      ).rejects.toThrow(/overlap/);
    });
  });

  // ── No-change ───────────────────────────────────────────

  it("single no-op exact edit → succeeds with note", async () => {
    await withTempFile("A\nx\nB\n", async (path) => {
      const result = await executeEdit(
        { path, edits: [{ oldText: "x\n", newText: "x\n" }] },
        cwd,
      );
      expect(result.content[0].text).toMatch(/identical content/);
      expect(await readFile(path, "utf-8")).toBe("A\nx\nB\n");
    });
  });

  it("batch with one no-op and one real edit → real edit applies", async () => {
    await withTempFile("A\nx\nB\ny\nC\n", async (path) => {
      const result = await executeEdit(
        { path, edits: [{ oldText: "x\n", newText: "x\n" }, { oldText: "y\n", newText: "Z\n" }] },
        cwd,
      );
      expect(result.content[0].text).toMatch(/no-ops/);
      expect(await readFile(path, "utf-8")).toBe("A\nx\nB\nZ\nC\n");
    });
  });

  // ── BOM ──────────────────────────────────────────────────

  it("handles UTF-8 BOM correctly", async () => {
    await withTempFile("\uFEFFline1\nline2\nline3\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "line2\n", newText: "REPLACED\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("\uFEFFline1\nREPLACED\nline3\n");
    });
  });

  // ── CRLF ────────────────────────────────────────────────

  it("preserves CRLF line endings", async () => {
    await withTempFile("line1\r\nline2\r\nline3\r\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "line2\r\n", newText: "REPLACED\r\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("line1\r\nREPLACED\r\nline3\r\n");
    });
  });

  // ── JSON string edits shim ──────────────────────────────

  it("handles edits sent as a JSON string", async () => {
    await withTempFile("A\nx\nB\n", async (path) => {
      const input = {
        path,
        edits: JSON.stringify([{ oldText: "x\n", newText: "REPLACED\n" }]),
      };
      await executeEdit(input as any, cwd);
      expect(await readFile(path, "utf-8")).toBe("A\nREPLACED\nB\n");
    });
  });

  // ── Fuzzy matching (normalized) ───────────────────────

  it("fuzzy: trailing whitespace mismatch → succeeds via normalization", async () => {
    await withTempFile("hello   \nworld  \nfoo\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "hello\nworld\n", newText: "HELLO\nWORLD\n" }] },
        cwd,
      );
      // Trailing whitespace in the matched region is normalized, replacement applied
      expect(await readFile(path, "utf-8")).toBe("HELLO\nWORLD\nfoo\n");
    });
  });

  it("fuzzy: smart quotes in file vs ASCII in oldText → succeeds", async () => {
    await withTempFile("before\nconsole.log(\u201Chello\u201D)\nafter\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: 'console.log("hello")\n', newText: "console.log('hi')\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("before\nconsole.log('hi')\nafter\n");
    });
  });

  it("fuzzy: unicode dash in file vs ASCII hyphen in oldText → succeeds", async () => {
    await withTempFile("before\nconst x = a\u2013b;\nafter\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "const x = a-b;\n", newText: "const x = a + b;\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("before\nconst x = a + b;\nafter\n");
    });
  });

  it("fuzzy: normalized match still requires uniqueness → throws", async () => {
    await withTempFile("hello   \nworld\nhello   \nworld\n", async (path) => {
      await expect(
        executeEdit({ path, edits: [{ oldText: "hello\nworld\n", newText: "X\n" }] }, cwd),
      ).rejects.toThrow(/multiple occurrences/);
    });
  });

  it("fuzzy: normalized match not found → throws", async () => {
    await withTempFile("hello\nworld\n", async (path) => {
      await expect(
        executeEdit({ path, edits: [{ oldText: "zzzzz\n", newText: "X\n" }] }, cwd),
      ).rejects.toThrow(/Could not find/);
    });
  });

  it("fuzzy: mixed exact and fuzzy edits in batch → all succeed", async () => {
    await withTempFile("AAA   \nBBB\nCCC\n", async (path) => {
      await executeEdit(
        {
          path,
          edits: [
            { oldText: "AAA\n", newText: "aaa\n" }, // fuzzy (trailing whitespace)
            { oldText: "CCC\n", newText: "ccc\n" }, // exact
          ],
        },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("aaa\nBBB\nccc\n");
    });
  });

  it("fuzzy: NFKC fullwidth punctuation → matches halfwidth oldText", async () => {
    // File has fullwidth comma (U+FF0C) and fullwidth parens (U+FF08, U+FF09)
    await withTempFile("\u4F60\u597D\uFF0C\u4E16\u754C\n\u4F60\u597D\uFF08\u4E16\u754C\uFF09\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "\u4F60\u597D,\u4E16\u754C\n\u4F60\u597D(\u4E16\u754C)\n", newText: "\u4F60\u597D\uFF0Cpi\n\u4F60\u597D(pi)\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("\u4F60\u597D\uFF0Cpi\n\u4F60\u597D(pi)\n");
    });
  });

  it("fuzzy: NFKC compatibility forms → fullwidth letters and combining accents", async () => {
    // File has fullwidth ABC123 (U+FF21-FF23, U+FF11-FF13) and combining accent (e + U+0301)
    await withTempFile("\uFF21\uFF22\uFF23\uFF11\uFF12\uFF13\ncafe\u0301\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "ABC123\ncaf\u00E9\n", newText: "XYZ789\ncoffee\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("XYZ789\ncoffee\n");
    });
  });

  it("fuzzy: non-breaking space → matches regular space in oldText", async () => {
    await withTempFile("hello\u00A0world\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "hello world\n", newText: "hello universe\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("hello universe\n");
    });
  });

  it("fuzzy: LF oldText matches against CRLF file content", async () => {
    await withTempFile("line one\r\nline two\r\nline three\r\n", async (path) => {
      await executeEdit(
        { path, edits: [{ oldText: "line two\n", newText: "replaced line\n" }] },
        cwd,
      );
      expect(await readFile(path, "utf-8")).toBe("line one\r\nreplaced line\r\nline three\r\n");
    });
  });

  it("fuzzy: detects duplicates across CRLF/LF variants", async () => {
    await withTempFile("hello\r\nworld\r\n---\r\nhello\nworld\n", async (path) => {
      await expect(
        executeEdit({ path, edits: [{ oldText: "hello\nworld\n", newText: "replaced\n" }] }, cwd),
      ).rejects.toThrow(/multiple occurrences/);
    });
  });
});
