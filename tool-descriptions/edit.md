Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.

You can abbreviate oldText with `...` on its own line. Write at least 3 lines, then `...`, then at least 3 more lines — the tool matches the first and last lines and replaces the entire block between them. The lines before and after `...` are part of the replaced region, so include them in newText if you want to keep them.

Use exact text for regions up to a few lines. For larger regions (10+ lines), `...` saves retyping — just ensure the surrounding lines uniquely identify the block.

If the exact text is not found, the tool tolerates minor differences (trailing whitespace, smart quotes, Unicode dashes). When this happens, trailing whitespace is stripped from ALL lines in the file, not just the edited region — review the diff carefully.
