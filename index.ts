import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerEditTool } from "./src/tool-definition.js";

export default function (pi: ExtensionAPI): void {
  registerEditTool(pi, process.cwd());
}
