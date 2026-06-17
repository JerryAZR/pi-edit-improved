# Agent-Driven Edit Tool Test

Create a temporary test file and verify the context-bounded edit tool's behavior end-to-end.

**Do not use bash except where explicitly instructed.** All file modifications must go through the `edit` tool unless a scenario specifically tells you to use bash.

---

## Setup

Create `test-file.ts` with this content:

```
import { thing } from "./lib";

function hello() {
  console.log("hello");
}

// filler line 1
// filler line 2
// filler line 3
// filler line 4
// filler line 5
// filler line 6
// filler line 7
// filler line 8
// filler line 9
// filler line 10
// filler line 11
// filler line 12
// filler line 13
// filler line 14
// filler line 15
// filler line 16
// filler line 17
// filler line 18
// filler line 19
// filler line 20
// filler line 21
// filler line 22
// filler line 23
// filler line 24
// filler line 25
// filler line 26
// filler line 27
// filler line 28
// filler line 29
// filler line 30
// filler line 31
// filler line 32
// filler line 33
// filler line 34
// filler line 35
// filler line 36
// filler line 37
// filler line 38
// filler line 39
// filler line 40
// filler line 41
// filler line 42
// filler line 43
// filler line 44
// filler line 45
// filler line 46
// filler line 47
// filler line 48

function goodbye() {
  console.log("goodbye");
  console.log("see ya");
}

export { hello, goodbye };
```

Reset the file content between tests if needed.

---

## Happy Path

### 1. Replace a single line

Change `console.log("hello");` to `console.log("hi");` in `test-file.ts`. Nothing else should change.

### 2. Replace multiple lines

Replace the two lines `console.log("goodbye");` and `console.log("see ya");` with `console.log("farewell");` and `console.log("adios");`. The closing `}` of the goodbye function must remain intact.

### 3. Delete lines at end of file

Remove the blank line and the `export { hello, goodbye };` line at the bottom of the file. The file should end with the closing `}` of the goodbye function.

### 4. Diff in output

After a successful edit, verify the response includes a unified diff showing the changes.

### 5. Two edits in one request

In a single edit call, change `console.log("hello");` to `console.log("hi");` and `console.log("goodbye");` to `console.log("ciao");`. Both changes must apply.

### 6. Insert a line between existing lines

Add a new line `console.log("extra");` inside the hello function, between the existing `console.log("hello");` and the closing `}`. Both existing lines must remain.

### 7. Delete a large region

Remove all 48 filler lines in one edit. The file should go directly from the hello function to the goodbye function with no filler lines remaining.

---

## Insert at BOF / EOF

### 8. Insert at beginning of file

Add `// Copyright 2026` as the very first line of `test-file.ts`. The original first line must still exist, just moved down.

### 9. Insert at end of file

Add `// END` as the very last line of `test-file.ts`. The original last line must still exist, just moved up.

### 10. Replace entire file

Replace the entire content of `test-file.ts` with new content. The file should contain exactly the new content and nothing else.

---

## Error Handling

### 11. Ambiguous region

Attempt an edit where the surrounding context matches more than one location in the file. The tool must reject it.

### 12. Context not found

Attempt an edit where the surrounding context does not appear in the file. The tool must reject it.

### 13. Overlapping edits

Attempt a single edit call with two edits whose target regions overlap. The tool must reject the entire request.

### 14. No-op edit

Attempt an edit where the replacement text is identical to the content being replaced. The tool must succeed with a note that the edit was a no-op. The file must remain unchanged.

### 15. Missing required fields

Send an edit request with `edits` missing. The tool must return a clear error, not crash.

### 16. Edit a directory

Try editing a directory path. The tool must return a clear error.

---

## Edge Cases

### 17. CRLF line endings

Use bash to create a CRLF file: `printf "line1\r\nline2\r\nline3\r\n" > crlf.txt`. Edit the middle line. CRLF line endings must be preserved.

### 18. UTF-8 BOM

Use bash to create a file with a BOM: `printf '\xEF\xBB\xBFline1\nline2\n' > bom.txt`. Edit the file. The BOM must be preserved.

---

## Cleanup

Delete `test-file.ts`, `crlf.txt`, and `bom.txt`.
