# pi-edit-improved

An improved `edit` tool for [pi](https://pi.dev) coding agent, extending exact-text replacement with ellipsis support for large blocks.

## Motivation

Every coding agent needs an edit tool. Three approaches dominate:

### 1. Exact text replacement (pi built-in)

The model provides the exact text to find (`oldText`) and its replacement (`newText`). Simple and reliable for small changes.

**Pain points:** For large blocks (50+ lines), the model must reproduce every token correctly. One wrong character and the edit fails. Even on success, thousands of output tokens are wasted on text the user never sees — the model is just echoing the file back.

### 2. Hash-anchored lines (oh-my-pi)

Lines carry content hashes. Edits reference `LINE#HASH` anchors instead of repeating content. Eliminates long `oldText`.

**Pain points:** Introduces stale anchors — if the file changes between read and edit, anchors break. Agents struggle with boundary lines: the same line appearing as both `+` in one diff and context in the next produces duplicate or missing lines. Hash anchors also don't compose well with chain-of-thought or editing without a prior read.

### 3. Diff-based (OpenAI Codex)

The model outputs a unified diff. Clean and token-efficient.

**Pain points:** Only GPT-class models produce reliable diffs. Open-weight / budget models frequently produce broken patches with wrong line numbers or malformed headers.

## This project: ellipsis-enhanced exact text replacement

Keep the `{ oldText, newText }` schema agents already know, but let them abbreviate large blocks with `...`:

```json
{
  "oldText": "function setup() {\n  // init\n...\n  return result;\n}\n",
  "newText": "function setup() {\n  // init\n  // new logic\n  return result;\n}\n"
}
```

The tool matches the first and last lines, then replaces the entire block. The model only types the parts that matter.

### How it works

1. **Exact match first** — if `oldText` appears verbatim in the file, use it (preserves backward compatibility)
2. **Ellipsis fallback** — if exact match fails and `oldText` contains `...` on its own line, split into segments and match them as an ordered subsequence
3. **Error** — otherwise, standard not-found / ambiguous errors

Multiple `...` lines are supported for complex blocks:

```json
{
  "oldText": "class Foo {\n...\n  bar() {\n...\n  }\n...\n}",
  "newText": "..."
}
```

The segments `["class Foo {", "bar() {", "}", "}"]` must all appear in the file in order.

### What's preserved from built-in

- Same `{ oldText, newText }` schema
- Same prompt patterns (`description`, `promptSnippet`, `promptGuidelines`)
- Same batch syntax and overlap detection
- Same BOM / CRLF handling
- `withFileMutationQueue` for serialized file access
