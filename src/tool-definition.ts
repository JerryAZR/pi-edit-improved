import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { readFileSync } from "fs";
import { editSchema, executeEdit, type EditInput } from "./edit.js";
import { resolveToCwd } from "./path-utils.js";

const EDIT_DESC = readFileSync(
  new URL("../tool-descriptions/edit.md", import.meta.url),
  "utf-8",
).trim();

const EDIT_PROMPT_SNIPPET = readFileSync(
  new URL("../tool-descriptions/edit-snippet.md", import.meta.url),
  "utf-8",
).trim();

function colorizeDiff(diff: string, theme: any): string {
  return diff
    .split("\n")
    .map((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        return theme.fg("success", line);
      }
      if (line.startsWith("-") && !line.startsWith("---")) {
        return theme.fg("error", line);
      }
      if (line.startsWith("@@")) {
        return theme.fg("dim", line);
      }
      return line;
    })
    .join("\n");
}

export function createEditToolDefinition(cwd: string): ToolDefinition {
  return {
    name: "edit",
    label: "Edit",
    description: EDIT_DESC,
    parameters: editSchema,
    promptSnippet: EDIT_PROMPT_SNIPPET,
    promptGuidelines: [
      "Use edit for precise changes (edits[].oldText must match exactly). Prefer exact text for short regions. Use '...' to abbreviate long regions — include at least 3 lines before and after it.",
      "When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
      "Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
      "Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
    ],
    renderShell: "default",
    renderCall(args, theme, context) {
      const path = typeof (args as any)?.path === "string" ? (args as any).path : undefined;
      const text = new Text("", 0, 0);

      if (!path) {
        text.setText(theme.fg("toolTitle", theme.bold("edit")));
        return text;
      }

      const pathDisplay = theme.fg("accent", path);
      if (!context.argsComplete) {
        text.setText(`${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}`);
        return text;
      }

      const edits = Array.isArray((args as any)?.edits) ? (args as any).edits : [];
      text.setText(
        `${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}\n` +
        `  Editing ${edits.length} block(s)`,
      );
      return text;
    },
    renderResult(result, _options, theme, context) {
      if (context.isError) {
        const errorText = (result as any)?.content
          ?.filter((c: any) => c.type === "text")
          .map((c: any) => c.text ?? "")
          .join("\n") ?? "";
        const container = new Container();
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("error", errorText), 0, 0));
        return container;
      }

      const diff = (result as any)?.details?.diff;
      if (diff) {
        const coloredDiff = colorizeDiff(diff, theme);
        const container = new Container();
        container.addChild(new Spacer(1));
        container.addChild(new Text(coloredDiff, 0, 0));
        return container;
      }

      const text = (result as any)?.content
        ?.filter((c: any) => c.type === "text")
        .map((c: any) => c.text ?? "")
        .join("\n") ?? "";
      const container = new Container();
      container.addChild(new Spacer(1));
      container.addChild(new Text(text, 0, 0));
      return container;
    },
    async execute(_toolCallId, input, signal) {
      const resolved = { ...(input as EditInput), path: resolveToCwd((input as EditInput).path, cwd) };
      return executeEdit(resolved, cwd);
    },
  };
}

export function registerEditTool(pi: ExtensionAPI, cwd: string): void {
  pi.registerTool(createEditToolDefinition(cwd));
}
